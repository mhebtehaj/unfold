#!/usr/bin/env python3
"""Create a standalone lesson and register its homepage link. Never publishes."""
import argparse
import html
from pathlib import Path
import re

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("slug", help="lowercase words separated by hyphens")
parser.add_argument("title")
parser.add_argument("--description", required=True)
args = parser.parse_args()
if not re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", args.slug):
    parser.error("slug must contain lowercase words separated by hyphens")
root = Path(__file__).resolve().parents[1]
destination = root / (args.slug + ".html")
if destination.exists():
    parser.error(f"page already exists: {destination.name}")
index_path = root / "index.html"
index = index_path.read_text()
marker = "<!-- QUICK EXPLAINERS -->"
if index.count(marker) != 1:
    parser.error("homepage must contain exactly one QUICK EXPLAINERS marker")
template = (root / "tools/explainer-template.html").read_text()
page = template.replace("{{TITLE}}", html.escape(args.title)).replace("{{DESCRIPTION}}", html.escape(args.description))
link = f'    <li><a href="{args.slug}.html">{html.escape(args.title)}</a><span> — {html.escape(args.description)}</span></li>\n    '
destination.write_text(page)
index_path.write_text(index.replace(marker, link + marker))
print(f"Created {destination.name} and its homepage link. Add lesson content before publishing.")
