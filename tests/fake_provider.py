"""Test-only image server. Never included in the application image."""
import asyncio
import base64
from email.parser import BytesParser
from email.policy import default
from fastapi import FastAPI, Request

app = FastAPI()


@app.get('/v1/models')
async def models():
    return {'data': [{'id': 'test-model'}]}


@app.post('/v1/images/edits')
async def edit(request: Request):
    raw = await request.body()
    message = BytesParser(policy=default).parsebytes(
        ('Content-Type: ' + request.headers['content-type'] + '\r\n\r\n').encode() + raw)
    parts = list(message.iter_parts())
    fields = {part.get_param('name', header='content-disposition'): part.get_payload(decode=True)
              for part in parts if not part.get_filename()}
    assert fields['num_inference_steps'] == b'4'
    assert fields['guidance_scale'] == b'1.0'
    data = next(part.get_payload(decode=True) for part in parts if part.get_filename())
    await asyncio.sleep(.2)
    return {'data': [{'b64_json': base64.b64encode(data).decode()}]}
