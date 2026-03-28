from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
import json
import os
import uuid
import shutil

PHOTOS_DIR = "static/photos"
os.makedirs(PHOTOS_DIR, exist_ok=True)

app = FastAPI(title="CircleScore")

DATA_FILE = "data.json"


def load_data():
    if not os.path.exists(DATA_FILE):
        return {"people": [], "scores": {}, "meetings": []}
    with open(DATA_FILE, "r") as f:
        return json.load(f)


def save_data(data):
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2)


def pair_key(a: str, b: str) -> str:
    """Always same key regardless of order."""
    return "__".join(sorted([a, b]))


def predict_score(person_ids: List[str], scores: dict) -> dict:
    """
    Weighted mean: pairs far from neutral (5.5) carry more weight.
    Strong chemistry or real friction matters more than middle-ground pairs.
    """
    if len(person_ids) < 2:
        return {"score": None, "pairs": [], "missing_pairs": []}

    NEUTRAL = 5.5
    BASE_WEIGHT = 0.4   # floor so every pair still counts a little

    pairs = []
    missing_pairs = []
    pair_scores = []

    for i in range(len(person_ids)):
        for j in range(i + 1, len(person_ids)):
            key = pair_key(person_ids[i], person_ids[j])
            if key in scores:
                pairs.append({"key": key, "score": scores[key]})
                pair_scores.append(scores[key])
            else:
                missing_pairs.append(key)
                pair_scores.append(5.0)

    if not pair_scores:
        return {"score": None, "pairs": [], "missing_pairs": []}

    weights = [abs(s - NEUTRAL) + BASE_WEIGHT for s in pair_scores]
    weighted_avg = sum(s * w for s, w in zip(pair_scores, weights)) / sum(weights)

    score = round(max(1.0, min(10.0, weighted_avg)), 1)
    return {"score": score, "pairs": pairs, "missing_pairs": missing_pairs}


# --- Models ---

class Person(BaseModel):
    name: str
    is_admin: bool = False


class ScoreUpdate(BaseModel):
    person_a: str
    person_b: str
    score: float  # 1-10


class MeetingLog(BaseModel):
    participant_ids: List[str]
    rating: float  # 1-10, how the meeting actually went


class PredictRequest(BaseModel):
    person_ids: List[str]


# --- API Routes ---

@app.get("/api/people")
def get_people():
    data = load_data()
    return data["people"]


@app.post("/api/people")
def add_person(person: Person):
    data = load_data()
    new_person = {
        "id": str(uuid.uuid4()),
        "name": person.name,
        "is_admin": person.is_admin
    }
    data["people"].append(new_person)
    save_data(data)
    return new_person


@app.put("/api/people/{person_id}")
def update_person(person_id: str, person: Person):
    data = load_data()
    for p in data["people"]:
        if p["id"] == person_id:
            p["name"] = person.name
            save_data(data)
            return p
    raise HTTPException(status_code=404, detail="Person not found")


@app.post("/api/people/{person_id}/photo")
async def upload_photo(person_id: str, file: UploadFile = File(...)):
    data = load_data()
    person = next((p for p in data["people"] if p["id"] == person_id), None)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".jpg", ".jpeg", ".png", ".webp", ".gif"]:
        raise HTTPException(status_code=400, detail="Invalid image type")

    filename = f"{person_id}{ext}"
    filepath = os.path.join(PHOTOS_DIR, filename)
    with open(filepath, "wb") as f:
        shutil.copyfileobj(file.file, f)

    person["photo"] = f"/static/photos/{filename}"
    save_data(data)
    return {"photo": person["photo"]}


@app.delete("/api/people/{person_id}")
def delete_person(person_id: str):
    data = load_data()
    data["people"] = [p for p in data["people"] if p["id"] != person_id]
    # Remove all pair scores involving this person
    data["scores"] = {
        k: v for k, v in data["scores"].items()
        if person_id not in k.split("__")
    }
    save_data(data)
    return {"ok": True}


@app.get("/api/scores")
def get_scores():
    data = load_data()
    return data["scores"]


@app.post("/api/scores")
def set_score(update: ScoreUpdate):
    if not (1 <= update.score <= 10):
        raise HTTPException(status_code=400, detail="Score must be between 1 and 10")
    data = load_data()
    key = pair_key(update.person_a, update.person_b)
    data["scores"][key] = update.score
    save_data(data)
    return {"key": key, "score": update.score}


@app.post("/api/predict")
def predict(req: PredictRequest):
    if len(req.person_ids) < 2:
        raise HTTPException(status_code=400, detail="Select at least 2 people")
    data = load_data()

    # Special rule: Guy + Itay in a group larger than just the two of them = score 0
    if len(req.person_ids) > 2:
        selected_names = {
            p["name"].lower()
            for p in data["people"]
            if p["id"] in req.person_ids
        }
        if any("guy" in n for n in selected_names) and any("itay" in n for n in selected_names):
            return {"score": 0.0, "pairs": [], "missing_pairs": [], "override": "guy_itay_rule"}

    result = predict_score(req.person_ids, data["scores"])
    return result


@app.post("/api/meeting")
def log_meeting(meeting: MeetingLog):
    if len(meeting.participant_ids) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 participants")
    if not (1 <= meeting.rating <= 10):
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 10")

    data = load_data()

    # Update pairwise scores with weighted learning
    LEARNING_RATE = 0.25
    for i in range(len(meeting.participant_ids)):
        for j in range(i + 1, len(meeting.participant_ids)):
            key = pair_key(meeting.participant_ids[i], meeting.participant_ids[j])
            old = data["scores"].get(key, 5.0)
            new_score = round((1 - LEARNING_RATE) * old + LEARNING_RATE * meeting.rating, 2)
            data["scores"][key] = new_score

    # Log meeting history
    import datetime
    data["meetings"].append({
        "id": str(uuid.uuid4()),
        "date": datetime.datetime.now().isoformat(),
        "participant_ids": meeting.participant_ids,
        "rating": meeting.rating
    })

    save_data(data)
    return {"ok": True, "updated_pairs": len(meeting.participant_ids) * (len(meeting.participant_ids) - 1) // 2}


# --- Serve frontend ---

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def index():
    return FileResponse("static/index.html")
