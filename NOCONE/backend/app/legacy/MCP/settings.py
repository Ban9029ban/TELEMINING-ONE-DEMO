from dotenv import load_dotenv, find_dotenv, get_key

load_dotenv()
AZURE_API_KEY = get_key(find_dotenv(), "AZURE_API_KEY")
AZURE_URL = get_key(find_dotenv(), "AZURE_URL")
AZURE_API_VERSION = get_key(find_dotenv(), "AZURE_API_VERSION")

MESES_ES = [
        "enero", "febrero", "marzo", "abril", "mayo", "junio",
        "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
    ]

def fmt_es(dt):
    return f"{dt.day} de {MESES_ES[dt.month-1]} de {dt.year}, {dt.strftime('%H:%M:%S')}"