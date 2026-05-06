from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

# MySQL Async Configuration
engine = create_async_engine(
    settings.DATABASE_URL, 
    pool_pre_ping=True,
    pool_recycle=3600
)

SessionLocal = async_sessionmaker(
    bind=engine, 
    class_=AsyncSession, 
    expire_on_commit=False
)

class Base(DeclarativeBase):
    pass

async def get_db():
    async with SessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
