from openai import AzureOpenAI
from app.legacy.telemining.config import settings
import MCP.prompts.request as req
import MCP.prompts.response as resp

def get_client():
    """Inicializa y devuelve el cliente de Azure OpenAI"""
    try:
        if not settings.AZURE_API_KEY or not settings.AZURE_URL:
            raise EnvironmentError("Faltan las variables de entorno para AzureOpenAI.")
        
        client = AzureOpenAI(
            api_key=settings.AZURE_API_KEY,
            api_version=settings.AZURE_API_VERSION,
            azure_endpoint=settings.AZURE_URL
        )
        return client
    except Exception as e:
        print(f"Error al inicializar el cliente de Azure OpenAI: {e}")
        return None
    
def interpret_message(mensaje):
    """Interpreta el mensaje y lo envía al modelo de Azure OpenAI"""
    client = get_client()
    if not client:
        return "Error al inicializar el cliente de Azure OpenAI."

    try:
        response = client.chat.completions.create(
            model="qrttest_llm",
            messages=[
                {"role": "system", "content": req.SYSTEM_PROMPT},
                {"role": "user", "content": mensaje}
            ],
            temperature=0.40
        )
        content = response.choices[0].message.content.strip()

        # 🔧 Sanear bloque markdown tipo ```json ... ``` o ``` ... ```
        if content.startswith("```"):
            lines = content.splitlines()
            content = "\n".join(line for line in lines if not line.strip().startswith("```"))

        return content
    except Exception as e:
        return f"Error al procesar el mensaje: {e}"

def interpret_response(respuesta: dict) -> str:
    """
    Toma la respuesta compuesta por el mensaje del usuario y los títulos de las tablas generadas, 
    y genera una interpretación textual resumida usando el modelo de Azure OpenAI.
    """
    client = get_client()
    if not client:
        return "Error al inicializar el cliente de Azure OpenAI."

    try:
        # Convertimos a string controlado y entendible por el LLM
        mensaje_usuario = respuesta.get("Mensaje_Usuario", "")
        titulos = respuesta.get("titulos", [])

        entrada_modelo = f"Mensaje_Usuario: {mensaje_usuario}\nTitulos de tablas generadas: {', '.join(titulos)}"

        response = client.chat.completions.create(
            model="qrttest_llm",
            messages=[
                {"role": "system", "content": resp.SYSTEM_PROMPT},
                {"role": "user", "content": entrada_modelo}
            ],
            temperature=0.40
        )
        return response.choices[0].message.content
    except Exception as e:
        return f"Error al procesar el mensaje: {e}"
