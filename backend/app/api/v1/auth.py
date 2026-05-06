"""
Authentication API — Login, Register, Refresh Token, Logout
"""

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from jose import jwt
import bcrypt
import secrets

from app.core.database import get_db
from app.core.config import settings
from app.models.models import User, Role, RefreshToken
from app.schemas.schemas import (
    LoginRequest, LoginResponse, UserCreate, UserOut,
    RefreshRequest, TokenResponse
)
from app.core.logger import logger

router = APIRouter()

# ─── Helpers ──────────────────────────────────────────────────

def ensure_aware_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user: User) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRES_MINUTES)
    payload = {
        "sub": user.id,
        "email": user.email,
        "role": user.role.name if user.role else "viewer",
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token() -> str:
    return secrets.token_urlsafe(64)


from sqlalchemy.orm import selectinload

async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(
        select(User)
        .where(User.email == email)
        .options(selectinload(User.role))
    )
    return result.scalar_one_or_none()


# ─── Endpoints ────────────────────────────────────────────────

@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    """Register a new user account."""
    existing = await get_user_by_email(db, payload.email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered.")

    # Resolve role
    role_result = await db.execute(select(Role).where(Role.name == "agent"))
    default_role = role_result.scalar_one_or_none()

    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        role_id=payload.role_id or (default_role.id if default_role else None),
    )
    db.add(user)
    await db.flush()
    await db.commit()
    await db.refresh(user, ["role"])
    logger.info(f"New user registered: {user.email}")
    return user


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Authenticate with email + password, returns JWT access + refresh tokens."""
    user = await get_user_by_email(db, payload.email)
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials.")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled.")

    # Update last login
    user.last_login_at = datetime.now(timezone.utc)

    # Create tokens
    access_token = create_access_token(user)
    raw_refresh = create_refresh_token()

    db_token = RefreshToken(
        user_id=user.id,
        token=raw_refresh,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.JWT_REFRESH_EXPIRES_DAYS),
    )
    db.add(db_token)
    await db.commit()

    await db.refresh(user, ["role"])
    logger.info(f"User logged in: {user.email} from {request.client.host}")

    return LoginResponse(
        access_token=access_token,
        refresh_token=raw_refresh,
        user=UserOut.model_validate(user),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(payload: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """Exchange a valid refresh token for a new access token."""
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token == payload.refresh_token)
    )
    db_token = result.scalar_one_or_none()
    expires_at = ensure_aware_datetime(db_token.expires_at) if db_token else None

    if not db_token or not expires_at or expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token.")

    user_result = await db.execute(select(User).where(User.id == db_token.user_id))
    user = user_result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive.")

    await db.refresh(user, ["role"])
    return TokenResponse(access_token=create_access_token(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(payload: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """Revoke a refresh token (logout)."""
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token == payload.refresh_token)
    )
    db_token = result.scalar_one_or_none()
    if db_token:
        await db.delete(db_token)
        await db.commit()
