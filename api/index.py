"""Vercel Serverless Function entry — re-exports the Flask app from app.py."""

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app
