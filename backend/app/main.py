from contextlib import asynccontextmanager
from fastapi import FastAPI
from app.database import engine, Base
from app import models
from app.routers import posts


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Aurora Blog API", version="0.1.0", lifespan=lifespan)

app.include_router(posts.router)


@app.get("/")
def read_root():
    return {"message": "Aurora Blog API"}
