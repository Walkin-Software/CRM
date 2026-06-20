import motor.motor_asyncio
from app.core.config import settings

_mongo_client = None

def get_mongo_db():
    global _mongo_client
    if _mongo_client is None:
        _mongo_client = motor.motor_asyncio.AsyncIOMotorClient(
            settings.MONGODB_URI,
            tlsAllowInvalidCertificates=True
        )
    return _mongo_client["crm"]
