"""
gemini_recap.py — calls Google's Gemini API to generate a one-sentence recap
of the story content the listener missed while zoning out.

The API key is read ONLY from the GEMINI_API_KEY environment variable. On
Cloud Run, set it via a mounted Secret Manager secret — never bake it into
the image or commit it to a file.
"""

import os

from google import genai

_MODEL_NAME = "gemini-2.5-flash"

def get_client():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY environment variable is not set. "
            "On Cloud Run, wire it up as a Secret Manager secret."
        )
    return genai.Client(api_key=api_key)


def generate_recap(missed_text: str) -> str:
    client = get_client()
    prompt = (
        "The listener zoned out during an audiobook and missed this passage:\n\n"
        f'"{missed_text}"\n\n'
        "Write ONE short sentence recapping what they missed, so they can "
        "pick the story back up without confusion. No preamble, just the sentence."
    )

    response = client.models.generate_content(
        model=_MODEL_NAME,
        contents=prompt,
    )
    return response.text.strip()
