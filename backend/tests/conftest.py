import os

# main.py loads backend/.env (the real MongoDB URL). An existing env var wins
# over .env, so blank it before any test imports main: tests never touch the DB.
os.environ["DB"] = ""
