from fastapi import FastAPI

app = FastAPI(title="Aurora Blog API", version="0.1.0")


@app.get("/")
def read_root():
    return {"message": "Aurora Blog API"}
