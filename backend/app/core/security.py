"""
JWT Security Utilities — decode token, get current user dependency.
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from jose import jwt, JWTError

from app.core.config import settings
from app.core.database import get_db
from app.models.models import User

bearer_scheme = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    FastAPI dependency: Validates the Bearer JWT and returns the current User object.
    Raises 401 if token is invalid or user not found.
    """
    token = credentials.credentials
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        user_id: str = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token payload.")
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Could not validate credentials: {e}",
            headers={"WWW-Authenticate": "Bearer"},
        )

    result = await db.execute(
        select(User).where(User.id == user_id, User.is_active == True)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found or inactive.")

    # Load role relationship
    await db.refresh(user, ["role"])
    return user


def require_role(*roles: str):
    """
    Dependency factory: ensures the current user has one of the required roles.
    Usage: current_user = Depends(require_role("admin", "agent"))
    """
    async def checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role and current_user.role.name in roles:
            return current_user
        raise HTTPException(status_code=403, detail="Insufficient permissions.")
    return checker
