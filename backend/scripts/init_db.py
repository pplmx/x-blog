#!/usr/bin/env python
"""Initialize database with sample data."""

import sys
sys.path.insert(0, ".")
from app.database import SessionLocal
from app import models, auth


def main():
    db = SessionLocal()

    try:
        # Check if admin already exists
        existing_admin = db.query(auth.User).filter(auth.User.username == "admin").first()
        if existing_admin:
            print("✓ Admin user already exists")
        else:
            admin = auth.User(
                username="admin",
                password=auth.get_password_hash("admin123"),
                is_superuser=True,
            )
            db.add(admin)
            print("✓ Admin user created (admin/admin123)")

        # Categories
        categories = ["前端开发", "后端开发", "技术分享", "学习笔记"]
        for name in categories:
            existing = db.query(models.Category).filter(models.Category.name == name).first()
            if not existing:
                db.add(models.Category(name=name))
        print("✓ Categories created")

        # Tags
        tags = ["React", "Next.js", "Python", "FastAPI", "TypeScript", "JavaScript", "CSS", "数据库"]
        for name in tags:
            existing = db.query(models.Tag).filter(models.Tag.name == name).first()
            if not existing:
                db.add(models.Tag(name=name))
        print("✓ Tags created")

        db.commit()
        print("\n✨ Database initialized successfully!")

    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()