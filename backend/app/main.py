from fastapi import FastAPI
from app.database import engine, Base

app = FastAPI(title="Aurora Blog API", version="0.1.0")


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)


@app.get("/")
def read_root():
    return {"message": "Aurora Blog API"}
