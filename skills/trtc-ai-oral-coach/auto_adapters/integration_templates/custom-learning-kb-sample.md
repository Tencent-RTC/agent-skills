# Custom Learning KB — Outbound Integration (Spec + Sample Only)

> custom-learning-kb is the **only outbound** capability. Your backend implements a search endpoint;
> the coach calls it to enrich scene candidates and report suggestions.

## Interface Contract

```
REQUEST  POST {KB_REST_BASE_URL}
  Headers: Authorization: Bearer {KB_REST_TOKEN}  (omit if auth not needed)
  Body:    {"query": "travel scenario speaking practice", "top_k": 3}
  Timeout: 8s

RESPONSE
  {"records": [
    {"text": "At the airport, practice checking in...", "source": "Travel Unit 3", "score": 0.95},
    {"text": "Booking a hotel room dialogue...", "source": "Travel Unit 1", "score": 0.82}
  ]}
```

## Configuration

Add to `.env`:

```bash
KB_ADAPTER=user_custom
KB_REST_BASE_URL=https://your-api.example.com/kb/search
KB_REST_TOKEN=your_bearer_token    # optional
KB_TOP_K=3
```

## Example Implementation

### Python (FastAPI)

```python
from fastapi import FastAPI, Request

app = FastAPI()

@app.post("/kb/search")
async def search(request: Request):
    body = await request.json()
    query = body["query"]
    top_k = body.get("top_k", 3)

    # Your search logic — vector DB / Elasticsearch / keyword match
    results = your_search_function(query, top_k)

    return {
        "records": [
            {"text": r.content, "source": r.document_name, "score": r.score}
            for r in results[:top_k]
        ]
    }
```

### Node.js (Express)

```javascript
app.post('/kb/search', express.json(), async (req, res) => {
  const { query, top_k = 3 } = req.body;

  // Your search logic
  const results = await yourSearchFunction(query, top_k);

  res.json({
    records: results.slice(0, top_k).map(r => ({
      text: r.content,
      source: r.docName,
      score: r.score
    }))
  });
});
```

## Fallback Behavior

- KB not configured → silently falls back to built-in question bank
- KB returns error / empty → silently falls back to built-in question bank
- No user impact — the coach always works, with or without KB
- Verify: `curl -X POST http://localhost:8000/api/v1/kb/retrieve -H 'Content-Type: application/json' -d '{"query":"test","top_k":3}'`

## Security

- Non-localhost endpoints **must** use HTTPS
- SSRF protection: private/internal IPs (10.*, 172.16-31.*, 192.168.*) are blocked
- Token is sent as Bearer header, not in URL
