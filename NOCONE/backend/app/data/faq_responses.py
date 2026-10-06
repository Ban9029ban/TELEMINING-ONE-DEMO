# backend/app/data/faq_responses.py
from typing import Optional
from unidecode import unidecode

FAQ_ENTRIES = [
    {
        "id": "que_es_zenit",
        "keywords": [
            "que es TMOne",
            "qué es TMOne",
            "que es TMOne?",
            "qué es TMOne?",
            "que hace TMOne",
            "para que sirve TMOne",
        ],
        "answer": (
            "Zenit es una plataforma de monitoreo y control para minería, "
            "desarrollada por Telemining. Integra IoT, geolocalización y "
            "análisis en tiempo real para supervisar personas, vehículos y "
            "riesgos operacionales dentro de faenas mineras, entregando "
            "tableros de control, alertas y trazabilidad completa."
        ),
    },
    {
        "id": "que_es_telemining",
        "keywords": [
            "que es telemining",
            "qué es telemining",
            "quien es telemining",
            "telemining empresa",
        ],
        "answer": (
            "Telemining es una empresa tecnológica con más de 10 años en el "
            "mercado minero, especializada en soluciones de monitoreo, "
            "automatización y analítica avanzada para faenas. Desarrolla "
            "plataformas como TMOne para mejorar la seguridad, continuidad "
            "operacional y eficiencia de los procesos."
        ),
    },

    # ---------------------------------------------------------
    # Preguntas frecuentes de la pantalla MCP
    # ---------------------------------------------------------
    {
        "id": "ultima_ubicacion_equipos_personas",
        "keywords": [
            "ultima ubicacion de equipos y personas",
            "última ubicación de equipos y personas",
            "ultima ubicacion equipos",
            "ultima ubicacion personas",
            "donde estan los equipos",
            "donde estan las personas",
            "ubicacion actual de equipos",
            "ubicacion actual de personas",
        ],
        "answer": (
            "La última ubicación de equipos y personas en TMOne se obtiene a "
            "partir de los tags y sensores instalados en las URs. El sistema "
            "registra cada evento de paso y permanencia, y muestra en el "
            "mapa y tableros la posición más reciente reportada para cada "
            "equipo o persona, junto con la hora del último registro."
        ),
    },
    {
        "id": "tiempo_disipacion_gases",
        "keywords": [
            "cuanto tiempo tardan en disiparse los gases",
            "cuánto tiempo tardan en disiparse los gases",
            "tiempo de disipacion de gases",
            "disiparse los gases",
        ],
        "answer": (
            "El tiempo que tardan en disiparse los gases depende de la "
            "ventilación, geometría de la labor, caudal de aire y tipo de gas. "
            "Zenit no reemplaza los protocolos de ventilación ni los criterios "
            "de la supervisión en terreno: el sistema puede apoyar mostrando "
            "tendencias de sensores de calidad de aire y los tiempos "
            "históricos de recuperación por zona, pero siempre se deben seguir "
            "los procedimientos internos de seguridad de la compañía."
        ),
    },
    {
        "id": "urs_activas",
        "keywords": [
            "cuales son las urs activas",
            "cuáles son las urs activas",
            "urs activas",
            "que urs estan activas",
            "qué urs están activas",
            "estado de las urs",
        ],
        "answer": (
            "En TMOne se considera una UR activa cuando mantiene comunicación "
            "con la plataforma y tiene al menos un sensor en línea. El tablero "
            "de 'Estado de URs' muestra cuáles están operativas, en alerta o "
            "fuera de servicio, junto con el número de sensores online por UR."
        ),
    },
    {
        "id": "riesgos_termicos_por_zona",
        "keywords": [
            "que riesgos termicos existen por zona",
            "qué riesgos térmicos existen por zona",
            "riesgos termicos por zona",
            "riesgo termico por zona",
            "riesgos de temperatura por zona",
        ],
        "answer": (
            "Los riesgos térmicos por zona se evalúan en función de las "
            "lecturas de temperatura, humedad y otros parámetros de los "
            "sensores instalados. TMOne puede calcular indicadores como el "
            "riesgo de estrés térmico y clasificarlos por nivel de alerta, "
            "mostrando en los tableros qué zonas requieren mayor atención."
        ),
    },
    {
        "id": "vehiculos_y_personas_en_calle_18_17",
        "keywords": [
            "que vehiculos y personas estan en calle 18/17",
            "qué vehículos y personas están en calle 18/17",
            "quienes estan en calle 18/17",
            "personas en calle 18/17",
            "vehiculos en calle 18/17",
        ],
        "answer": (
            "Cuando se consulta por 'qué vehículos y personas están en Calle "
            "18/17', TMOne revisa los últimos eventos de acceso y permanencia "
            "registrados para esa zona. El sistema puede listar qué tags de "
            "personas y equipos se encuentran presentes, hace cuánto tiempo "
            "permanecen allí y, si corresponde, qué alertas o riesgos están "
            "asociados a esa ubicación."
        ),
    },

    # ---------------------------------------------------------
    # NUEVOS FACTS SUGERIDOS (ZENIT / TELEMINING / FAENAS)
    # ---------------------------------------------------------
    {
        "id": "que_es_una_ur",
        "keywords": [
            "que es una ur",
            "qué es una ur",
            "que significa ur",
            "unidad remota TMOne",
            "unidad de registro TMOne",
            "equipo ur TMOne",
        ],
        "answer": (
            "En TMOne una UR corresponde al equipo instalado en terreno que "
            "concentra sensores, antenas y comunicaciones en una zona de la "
            "faena. Cada UR actúa como punto lógico para medir presencia de "
            "personas y vehículos, estados de sensores y eventos operacionales "
            "en un sector específico del yacimiento."
        ),
    },
    {
        "id": "diferencia_np_ucl_oficina",
        "keywords": [
            "diferencia entre np y ucl",
            "que es np en TMOne",
            "qué es np en TMOne",
            "que es ucl en TMOne",
            "zonas np ucl oficina",
            "niveles np ucl oficina",
        ],
        "answer": (
            "En los proyectos donde se utiliza TMOne es común organizar las URs "
            "por niveles lógicos, por ejemplo NP (nivel de producción), UCL "
            "(nivel de cargas y logística) u Oficina/Superficie. Esta "
            "clasificación permite agrupar los eventos y KPIs por tipo de "
            "zona, facilitando los análisis de seguridad, ventilación y "
            "productividad por nivel de la mina."
        ),
    },
    {
        "id": "como_calcula_permanencia",
        "keywords": [
            "como calcula TMOne la permanencia",
            "cómo calcula TMOne la permanencia",
            "tiempo de permanencia en ur",
            "permanencia en zonas",
            "permanencia personas",
            "permanencia equipos",
        ],
        "answer": (
            "Zenit calcula el tiempo de permanencia a partir de los eventos de "
            "entrada y salida detectados por las URs y sensores. Cada vez que "
            "un tag cruza una zona se registra un inicio y un término de "
            "permanencia; la diferencia entre ambos tiempos se almacena como "
            "duración. Estos datos alimentan gráficos de tiempo de "
            "permanencia por persona, equipo, UR y zona."
        ),
    },
    {
        "id": "que_es_agente_ia_zenit",
        "title": "Que es el Agente IA TMOne",
        "details": [
            "Combina respuestas guiadas, consultas estructuradas y una capa conversacional para interpretar el contexto operativo.",
            "Tambien puede ayudarte a convertir preguntas amplias en consultas mas utiles.",
        ],
        "actions": [
            "Pide un resumen operativo del estado actual.",
            "Solicita una consulta por sitio, zona, fecha o tipo de entidad.",
        ],
        "follow_ups": [
            "Que tipo de preguntas me recomiendas hacerte?",
            "Que informacion de la base puedes consultar de forma segura?",
        ],
        "keywords": [
            "que es el agente ia TMOne",
            "qué es el agente ia TMOne",
            "para que sirve el agente ia",
            "para que sirve el mcp",
            "mcp agente ia",
            "agente ia TMOne",
        ],
        "answer": (
            "El Agente IA TMOne (MCP) es un asistente conversacional que "
            "permite consultar la información de la faena usando lenguaje "
            "natural. Combina respuestas predefinidas, consultas a la base de "
            "datos y un modelo de lenguaje para explicar el contexto de TMOne, "
            "orientar al usuario y apoyar la toma de decisiones operacionales."
        ),
    },
    {
        "id": "que_puede_hacer_agente_ia",
        "title": "Que puede hacer el agente",
        "details": [
            "Puede responder como asistente, resumir datos visibles y ayudarte a interpretar hallazgos operacionales.",
            "Si la consulta es amplia, puede pedir una aclaracion y proponer caminos de seguimiento.",
        ],
        "actions": [
            "Prueba una consulta con sitio, zona o periodo.",
            "Si quieres, te sugiero preguntas utiles para monitoreo, control o alertas.",
        ],
        "follow_ups": [
            "Dame ejemplos de consultas operacionales utiles.",
            "Explicame como filtrar por sitio, zona o fecha.",
        ],
        "keywords": [
            "que puede hacer el agente ia",
            "qué puede hacer el agente ia",
            "que consultas puedo hacer al agente ia",
            "como usar el agente ia TMOne",
        ],
        "answer": (
            "El agente IA puede responder preguntas frecuentes sobre TMOne y "
            "Telemining, explicar el significado de los tableros, ayudar a "
            "interpretar tendencias y, según la configuración del proyecto, "
            "consultar datos históricos de eventos, permanencias y estados de "
            "URs. No reemplaza la supervisión ni los procedimientos internos, "
            "pero sirve como capa de ayuda rápida para el personal de turno."
        ),
    },
    {
        "id": "integracion_codelco",
        "keywords": [
            "codelco",
            "uso en codelco",
            "como se usa TMOne en codelco",
            "zenit en divisiones de codelco",
        ],
        "answer": (
            "En proyectos típicos de minería subterránea, incluyendo faenas de "
            "grandes compañías como Codelco, TMOne se utiliza como plataforma "
            "de apoyo para la supervisión de personas, equipos y condiciones "
            "operacionales. La solución se adapta a los estándares y "
            "procedimientos internos de cada división, y su objetivo principal "
            "es mejorar la visibilidad en tiempo real y la trazabilidad de los "
            "movimientos dentro de la mina."
        ),
    },
    {
        "id": "cumplimiento_normativo",
        "keywords": [
            "cumplimiento normativo",
            "seguridad minera",
            "normativa de seguridad",
            "cumplir normativa",
            "ds 132",
            "ds132",
            "ds 594",
        ],
        "answer": (
            "Zenit no reemplaza la responsabilidad del empleador frente a la "
            "normativa de seguridad minera, pero aporta evidencia objetiva "
            "para respaldar el cumplimiento. A través de los registros de "
            "presencia, permanencias, alarmas y estados de equipos, la "
            "plataforma facilita auditorías internas y externas y ayuda a "
            "demostrar trazabilidad frente a los procedimientos definidos por "
            "la compañía y la legislación vigente."
        ),
    },
    {
        "id": "que_datos_registra_zenit",
        "title": "Que datos registra TMOne",
        "details": [
            "El catalogo visible para IA se limita a estructuras aprobadas para consulta segura.",
            "La cobertura exacta depende del proyecto, la semilla demo y los modulos activos.",
        ],
        "actions": [
            "Pide el catalogo de tablas y campos disponibles.",
            "Solicita un ejemplo concreto de consulta sobre personas, vehiculos o clima.",
        ],
        "follow_ups": [
            "Que tablas y campos tienes habilitados para IA?",
            "Que informacion puedes mostrarme sobre clima y alertas?",
        ],
        "keywords": [
            "que datos registra TMOne",
            "qué datos registra TMOne",
            "que informacion guarda TMOne",
            "datos que guarda TMOne",
            "datos historicos TMOne",
        ],
        "answer": (
            "Zenit registra eventos de acceso y permanencia de personas y "
            "vehículos, estados de URs y sensores, alarmas operacionales y "
            "ambientales, y otros datos derivados como tiempos de exposición, "
            "niveles de riesgo y uso de infraestructura crítica. La cantidad "
            "exacta de datos depende de la configuración de cada proyecto, "
            "pero en general se mantiene un historial suficiente para análisis "
            "operacional y de seguridad."
        ),
    },
    {
        "id": "filtros_fechas_cargos_zonas",
        "title": "Como usar los filtros del agente",
        "details": [
            "El sitio restringe la faena consultada.",
            "La zona ayuda a bajar la respuesta a un sector puntual.",
            "El cargo sirve para orientar el lenguaje y foco operacional.",
        ],
        "actions": [
            "Primero define si quieres datos, analisis o ayuda.",
            "Luego agrega uno o dos filtros para evitar respuestas demasiado abiertas.",
        ],
        "follow_ups": [
            "Dame un ejemplo de consulta bien filtrada.",
            "Hazme una pregunta guiada para armar una consulta util.",
        ],
        "keywords": [
            "para que sirven los filtros de fechas",
            "para que sirve el filtro de fechas",
            "para que sirve el filtro de cargos",
            "para que sirve el filtro de zonas",
            "como usar los filtros del mcp",
            "filtros de fechas cargos zonas",
        ],
        "answer": (
            "En el Agente IA TMOne los filtros de fechas, cargos y zonas "
            "acotan el contexto de la consulta. Las fechas limitan el periodo "
            "de análisis, el cargo permite adaptar la respuesta al rol del "
            "usuario (por ejemplo supervisor, operador, prevención de riesgos) "
            "y las zonas ayudan a focalizar la información en sectores "
            "específicos de la mina. Cuanto más precisos sean los filtros, "
            "más contextualizada será la respuesta."
        ),
    },
    {
        "id": "como_preguntar_mejor",
        "title": "Como obtener mejores respuestas",
        "details": [
            "Las mejores consultas indican objetivo, alcance y contexto.",
            "Ayuda mucho mencionar sitio, zona, periodo y si buscas datos concretos o interpretacion.",
        ],
        "actions": [
            "Puedes empezar con una pregunta amplia y luego yo te ayudo a acotarla.",
            "Tambien puedes usar las preguntas sugeridas de la pantalla para tomar ritmo.",
        ],
        "follow_ups": [
            "Hazme una pregunta guiada para construir una consulta util.",
            "Dame tres ejemplos de buenas preguntas para el turno.",
        ],
        "keywords": [
            "como preguntarte mejor",
            "como usar mejor el agente",
            "como formular preguntas al agente",
            "como obtener mejores respuestas",
        ],
        "answer": (
            "Para obtener respuestas mas utiles conviene indicar que quieres revisar, "
            "en que sitio o zona, y si buscas datos concretos o una interpretacion. "
            "Si la consulta viene abierta, puedo ayudarte a convertirla en una pregunta "
            "mas precisa paso a paso."
        ),
    },
    {
        "id": "saludo_basico",
        "title": "Bienvenida del agente",
        "details": [
            "Puedo responder en formato conversacional y tambien entregar tablas o graficos cuando corresponde.",
            "Si la pregunta es amplia, te voy a pedir contexto para que la respuesta sea mas util.",
        ],
        "actions": [
            "Pide un resumen operativo de hoy.",
            "O dime que sitio o zona quieres revisar primero.",
        ],
        "follow_ups": [
            "Dame un resumen operativo de hoy.",
            "Que datos puedes consultar ahora mismo?",
            "Sugiere una consulta util para monitoreo.",
        ],
        "keywords": [
            "hola",
            "buen dia",
            "buen día",
            "buenas tardes",
            "buenas noches",
        ],
        "answer": (
            "Hola, soy el Agente IA de TMOne. Puedes hacerme preguntas sobre "
            "la plataforma, las URs, los tableros, riesgos por zona o pedir "
            "ayuda para interpretar información de la faena. Si lo deseas, "
            "puedes agregar filtros de fechas, cargos o zonas para que la "
            "respuesta sea más específica."
        ),
    },
]


def find_faq_entry(question: str) -> Optional[dict]:
    """
    Devuelve la entrada FAQ completa para poder enriquecer la salida del agente.
    """
    if not question:
        return None

    q = unidecode(question.lower().strip().replace("?", ""))

    for entry in FAQ_ENTRIES:
        for kw in entry["keywords"]:
            if unidecode(kw.lower()) in q:
                item = dict(entry)
                item.setdefault("title", entry["id"].replace("_", " ").capitalize())
                item.setdefault("follow_ups", [])
                item.setdefault("details", [])
                item.setdefault("actions", [])
                item.setdefault("source", "FAQ TMOne")
                return item

    return None


def find_faq_answer(question: str) -> Optional[str]:
    """
    Compatibilidad con el flujo anterior: devuelve solo el texto de respuesta.
    """
    entry = find_faq_entry(question)
    return entry["answer"] if entry else None
