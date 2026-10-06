from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from queue import Queue
import json

router = APIRouter()
connected_clients = []

def sse_event_generator(client_queue):
    """
    Generador que envía mensajes SSE al cliente cuando se reciben en la cola.
    """
    try:
        while True:
            message = client_queue.get()
            if message == 'close':
                break
            yield f"data: {json.dumps(message)}\n\n"
    except GeneratorExit:
        pass

@router.get("/sse")
async def sse_view():
    """
    Endpoint que establece la conexión SSE con el cliente.
    """
    client_queue = Queue()
    connected_clients.append(client_queue)
    response = StreamingResponse(
        sse_event_generator(client_queue),
        media_type='text/event-stream',
        headers={'Cache-Control': 'no-cache'}
    )
    return response

def broadcast_message(data):
    """
    Envía un mensaje a todos los clientes conectados.
    """
    for client in connected_clients:
        client.put(data)

def disconnect_client(client_queue):
    """
    Elimina el cliente de la lista y cierra su cola.
    """
    if client_queue in connected_clients:
        connected_clients.remove(client_queue)
        client_queue.put('close')