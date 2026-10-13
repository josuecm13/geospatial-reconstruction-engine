"""Place search: free-text geocoding for the map's search box."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.dependencies import get_geocoder
from app.api.errors import ApiError
from app.api.schemas import PlaceBboxOut, PlaceOut, PlaceSearchOut
from app.ingestion.geocoder import GeocoderUnavailable, NominatimGeocoder

router = APIRouter(tags=["places"])

MIN_QUERY_LENGTH = 2
MAX_QUERY_LENGTH = 200


@router.get("/places/search", response_model=PlaceSearchOut)
def search_places(
    q: str = Query(...),
    limit: int = Query(5, ge=1, le=10),
    geocoder: NominatimGeocoder | None = Depends(get_geocoder),
) -> PlaceSearchOut:
    query = q.strip()
    if not MIN_QUERY_LENGTH <= len(query) <= MAX_QUERY_LENGTH:
        raise ApiError(
            422,
            "invalid_request",
            "request validation failed",
            {"fields": [{"loc": ["query", "q"], "msg": f"must be {MIN_QUERY_LENGTH} to {MAX_QUERY_LENGTH} characters once trimmed"}]},
        )
    if geocoder is None:
        raise GeocoderUnavailable("place search is disabled on this server")
    results = geocoder.search(query, limit)
    return PlaceSearchOut(
        places=[
            PlaceOut(
                display_name=r.display_name,
                name=r.name,
                latitude=r.latitude,
                longitude=r.longitude,
                bbox=PlaceBboxOut(south=r.south, west=r.west, north=r.north, east=r.east),
                category=r.category,
                type=r.type,
            )
            for r in results
        ]
    )
