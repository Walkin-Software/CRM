import re
import uuid
import bcrypt
import aiomysql
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings
from app.core.logger import logger


async def ensure_database_exists():
    match = re.match(
        r"mysql\+aiomysql://([^:]+):([^@]*)@([^:/]+):?(\d+)?/(.+)",
        settings.DATABASE_URL,
    )
    if not match:
        logger.error("Invalid DATABASE_URL format")
        return
    user, password, host, port, dbname = match.groups()
    try:
        conn = await aiomysql.connect(
            host=host, port=int(port or 3306), user=user, password=password
        )
        async with conn.cursor() as cur:
            await cur.execute(
                f"CREATE DATABASE IF NOT EXISTS `{dbname}` "
                f"CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
        conn.close()
        logger.info(f"Database '{dbname}' ready.")
    except Exception as e:
        logger.error(f"ensure_database_exists failed: {e}")


engine = create_async_engine(settings.DATABASE_URL, pool_recycle=3600)
SessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with SessionLocal() as session:
        yield session
