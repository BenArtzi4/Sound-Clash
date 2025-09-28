"""
Simple WebSocket Service - Minimal working version for deployment
"""
import os
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Sound Clash WebSocket Service",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {
        "service": "Sound Clash WebSocket Service",
        "version": "1.0.0",
        "status": "running"
    }

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "websocket-service",
        "version": "1.0.0"
    }

@app.websocket("/ws/{game_code}")
async def websocket_endpoint(websocket: WebSocket, game_code: str):
    """Basic WebSocket endpoint"""
    await websocket.accept()
    logger.info(f"WebSocket connection accepted for game {game_code}")
    
    try:
        while True:
            data = await websocket.receive_text()
            await websocket.send_text(f"Message received: {data}")
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for game {game_code}")

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8002))
    logger.info(f"Starting WebSocket service on port {port}")
    uvicorn.run(
        "main_simple:app",
        host="0.0.0.0",
        port=port,
        reload=False
    )
