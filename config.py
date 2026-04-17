import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    """Flask configuration."""
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'dev-secret-change-in-production'
    
    USER1_USERNAME = os.environ.get('USER1_USERNAME')
    USER1_PASSWORD = os.environ.get('USER1_PASSWORD')
    USER2_USERNAME = os.environ.get('USER2_USERNAME')
    USER2_PASSWORD = os.environ.get('USER2_PASSWORD')
    
    # Build valid users dictionary – only these two accounts can log in
    VALID_USERS = {}
    if USER1_USERNAME and USER1_PASSWORD:
        VALID_USERS[USER1_USERNAME] = USER1_PASSWORD
    if USER2_USERNAME and USER2_PASSWORD:
        VALID_USERS[USER2_USERNAME] = USER2_PASSWORD
    
    # Security: fail early if not both users are set
    if len(VALID_USERS) != 2:
        raise ValueError("Both USER1 and USER2 credentials must be set in .env file")
