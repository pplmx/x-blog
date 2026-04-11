from sqlalchemy.orm import Session

from app.auth import User, get_password_hash
from app.database import Base, SessionLocal, engine


def create_admin():
    Base.metadata.create_all(bind=engine)

    db: Session = SessionLocal()
    try:
        existing = db.query(User).filter(User.username == "admin").first()

        if not existing:
            admin = User(
                username="admin",
                password=get_password_hash("admin123"),
                is_superuser=True,
            )
            db.add(admin)
            db.commit()
            print("Admin user created: admin / admin123")
        else:
            print("Admin user already exists")
    finally:
        db.close()


if __name__ == "__main__":
    create_admin()
