import re
import uuid
import bcrypt
import aiomysql
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings
from app.core.logger import logger


async def ensure_database_exists():
    """Connect to MySQL without a DB selected and create the database if missing."""
    match = re.match(
        r"mysql\+aiomysql://([^:]+):([^@]*)@([^:/]+):?(\d+)?/(.+)",
        settings.DATABASE_URL,
    )
    if not match:
        return
    user, password, host, port, dbname = match.groups()
    port = int(port) if port else 3306

    conn = await aiomysql.connect(host=host, port=port, user=user, password=password)
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                f"CREATE DATABASE IF NOT EXISTS `{dbname}` "
                f"CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
    finally:
        conn.close()


db_url = settings.DATABASE_URL
if db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    # asyncpg expects 'ssl=true' instead of 'sslmode=verify-full'
    db_url = db_url.replace("sslmode=verify-full", "ssl=true")
    db_url = db_url.replace("sslmode=require", "ssl=true")

engine = create_async_engine(
    db_url,
    pool_recycle=3600,
)

SessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with SessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def seed_default_data():
    """Create default roles and a first admin user on a fresh database."""
    async with AsyncSession(engine) as session:
        try:
            # Create default roles if missing
            for role_name in ("admin", "agent", "viewer"):
                exists = (await session.execute(
                    text("SELECT id FROM roles WHERE name = :n"), {"n": role_name}
                )).first()
                if not exists:
                    await session.execute(
                        text("INSERT INTO roles (id, name, permissions) VALUES (:id, :name, '[]')"),
                        {"id": str(uuid.uuid4()), "name": role_name},
                    )

            admin_role_id = (await session.execute(
                text("SELECT id FROM roles WHERE name = 'admin'")
            )).scalar_one()

            # Upsert admin user — always ensure known credentials exist
            hashed = bcrypt.hashpw(b"Nopass@123", bcrypt.gensalt()).decode()
            existing_admin = (await session.execute(
                text("SELECT id FROM users WHERE email = 'admin@exe.in'")
            )).first()
            if existing_admin:
                await session.execute(
                    text("UPDATE users SET password_hash = :pw, role_id = :role, is_active = 1 WHERE email = 'admin@exe.in'"),
                    {"pw": hashed, "role": admin_role_id},
                )
                logger.info("Admin password reset   |  email: admin@exe.in  |  password: Nopass@123")
            else:
                # check if the old one exists to migrate it
                existing_old = (await session.execute(
                    text("SELECT id FROM users WHERE email = 'admin@ifocussystec.in'")
                )).first()
                if existing_old:
                    await session.execute(
                        text("UPDATE users SET email = 'admin@exe.in', password_hash = :pw, role_id = :role, is_active = 1 WHERE email = 'admin@ifocussystec.in'"),
                        {"pw": hashed, "role": admin_role_id},
                    )
                    logger.info("Admin email migrated to admin@exe.in | password: Nopass@123")
                else:
                    await session.execute(
                        text(
                            "INSERT INTO users (id, email, password_hash, full_name, role_id, is_active) "
                            "VALUES (:id, :email, :pw, :name, :role, 1)"
                        ),
                        {
                            "id": str(uuid.uuid4()),
                            "email": "admin@exe.in",
                            "pw": hashed,
                            "name": "Admin",
                            "role": admin_role_id,
                        },
                    )
                    logger.info("Default admin created  |  email: admin@exe.in  |  password: Nopass@123")

            await session.commit()
        except Exception as exc:
            logger.warning(f"Seeding skipped or failed: {exc}")
            await session.rollback()
