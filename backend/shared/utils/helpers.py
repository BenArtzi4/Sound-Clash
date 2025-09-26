"""
Shared utility functions for Sound Clash microservices
"""

def generate_game_code() -> str:
    """Generate a unique 6-digit game code"""
    import random
    import string
    
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

def validate_team_name(name: str) -> bool:
    """Validate team name with Unicode support"""
    if not name or len(name.strip()) == 0:
        return False
    if len(name) > 50:
        return False
    return True

def format_response(data=None, message="Success", status="success"):
    """Standard API response format"""
    return {
        "status": status,
        "message": message,
        "data": data
    }
