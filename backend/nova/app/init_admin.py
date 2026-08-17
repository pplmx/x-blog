import os
import warnings

from sqlalchemy.orm import Session

from app.auth import ROLE_SUPERUSER, User, get_password_hash
from app.config import is_development
from app.database import Base, SessionLocal, engine

DEV_ADMIN_PASSWORD = "admin123"


def create_admin():
    Base.metadata.create_all(bind=engine)

    admin_password = os.getenv("ADMIN_PASSWORD")
    if not admin_password:
        if not is_development():
            raise RuntimeError(
                "ADMIN_PASSWORD is not set. Refusing to create an admin account with a "
                "publicly known default password outside development. Set ADMIN_PASSWORD, "
                "or set APP_ENV=development to use the dev default."
            )
        admin_password = DEV_ADMIN_PASSWORD
        warnings.warn(
            f"ADMIN_PASSWORD not set. Using the DEVELOPMENT-only default '{DEV_ADMIN_PASSWORD}'. "
            "Never run production with APP_ENV=development.",
            stacklevel=2,
        )

    db: Session = SessionLocal()
    try:
        existing = db.query(User).filter(User.username == "admin").first()

        if not existing:
            admin = User(
                username="admin",
                password=get_password_hash(admin_password),
                role=ROLE_SUPERUSER,
                is_superuser=True,
            )
            db.add(admin)
            db.commit()
            if is_development():
                print(f"Admin user created: admin / {admin_password}")
            else:
                print("Admin user created: admin")
            print("WARNING: Please change this password immediately after first login!")
        else:
            print("Admin user already exists")
    finally:
        db.close()


if __name__ == "__main__":
    create_admin()
