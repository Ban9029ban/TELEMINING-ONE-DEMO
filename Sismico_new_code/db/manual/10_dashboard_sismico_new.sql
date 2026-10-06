-- ============================================================
-- Dashboard Sísmico New - esquema funcional inicial
-- Multi empresa / multi site / multi pantalla / multi endpoint
-- ============================================================

create table if not exists ds_company (
    id                  bigserial primary key,
    code                varchar(60) not null unique,
    name                varchar(160) not null,
    is_active           boolean not null default true,
    created_at          timestamptz not null default now()
);

create table if not exists ds_site (
    id                  bigserial primary key,
    company_id          bigint not null references ds_company(id),
    code                varchar(60) not null,
    name                varchar(160) not null,
    timezone_name       varchar(80) not null default 'America/Santiago',
    description         text,
    is_active           boolean not null default true,
    created_at          timestamptz not null default now(),
    unique(company_id, code)
);

create table if not exists ds_site_map (
    id                  bigserial primary key,
    site_id             bigint not null references ds_site(id),
    code                varchar(80) not null,
    name                varchar(160) not null,
    background_image    text,
    width_px            integer,
    height_px           integer,
    version_label       varchar(40),
    is_active           boolean not null default true,
    created_at          timestamptz not null default now(),
    unique(site_id, code)
);

create table if not exists ds_state_catalog (
    id                  smallserial primary key,
    code                varchar(40) not null unique,
    display_name        varchar(90) not null,
    severity            smallint not null,
    color_hex           varchar(10),
    requires_attention  boolean not null default false,
    is_blocking         boolean not null default false
);

create table if not exists ds_map_object (
    id                  bigserial primary key,
    site_map_id         bigint not null references ds_site_map(id),
    code                varchar(120) not null,
    name                varchar(200) not null,
    object_type         varchar(40) not null default 'polygon',
    geometry_type       varchar(20) not null default 'rect',
    geometry_json       jsonb not null default '{}'::jsonb,
    icon_name           varchar(80),
    sort_order          integer not null default 100,
    is_active           boolean not null default true,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    unique(site_map_id, code)
);

create table if not exists ds_object_current_state (
    map_object_id       bigint primary key references ds_map_object(id) on delete cascade,
    state_id            smallint not null references ds_state_catalog(id),
    source_origin       varchar(30) not null default 'seed',
    observed_at         timestamptz not null default now(),
    metadata            jsonb not null default '{}'::jsonb,
    updated_at          timestamptz not null default now()
);

create table if not exists ds_object_state_event (
    id                  bigserial primary key,
    map_object_id       bigint not null references ds_map_object(id) on delete cascade,
    state_id            smallint not null references ds_state_catalog(id),
    source_origin       varchar(30) not null default 'seed',
    event_reason        varchar(160),
    metadata            jsonb not null default '{}'::jsonb,
    observed_at         timestamptz not null default now(),
    created_at          timestamptz not null default now()
);

create table if not exists ds_remote_source (
    id                  bigserial primary key,
    site_id             bigint references ds_site(id),
    code                varchar(80) not null unique,
    name                varchar(180) not null,
    source_type         varchar(40) not null,
    base_url            text,
    is_enabled          boolean not null default true,
    created_at          timestamptz not null default now()
);

create table if not exists ds_remote_endpoint (
    id                  bigserial primary key,
    remote_source_id    bigint not null references ds_remote_source(id),
    site_id             bigint references ds_site(id),
    code                varchar(120) not null unique,
    name                varchar(180) not null,
    endpoint_url        text not null,
    endpoint_kind       varchar(40) not null,
    parser_type         varchar(40) not null,
    polling_seconds     integer not null default 15,
    is_enabled          boolean not null default true,
    created_at          timestamptz not null default now()
);

create table if not exists ds_sync_run (
    id                  bigserial primary key,
    remote_endpoint_id  bigint not null references ds_remote_endpoint(id),
    started_at          timestamptz not null default now(),
    finished_at         timestamptz,
    status              varchar(20) not null default 'running',
    http_status         integer,
    records_found       integer,
    records_mapped      integer,
    error_message       text
);

create table if not exists ds_screen (
    id                  bigserial primary key,
    site_id             bigint not null references ds_site(id),
    site_map_id         bigint references ds_site_map(id),
    code                varchar(90) not null,
    name                varchar(160) not null,
    current_url         text,
    status_code         varchar(20) not null default 'offline',
    last_heartbeat_at   timestamptz,
    is_active           boolean not null default true,
    created_at          timestamptz not null default now(),
    unique(site_id, code)
);

create table if not exists ds_alert (
    id                  bigserial primary key,
    site_id             bigint not null references ds_site(id),
    map_object_id       bigint references ds_map_object(id),
    severity_code       varchar(20) not null,
    title               varchar(220) not null,
    message             text,
    status              varchar(20) not null default 'open',
    opened_at           timestamptz not null default now(),
    resolved_at         timestamptz
);

create table if not exists ds_traffic_device (
    id                  bigserial primary key,
    site_id             bigint not null references ds_site(id),
    code                varchar(90) not null,
    name                varchar(160) not null,
    ip_address          inet not null,
    command_template    text not null default 'ipsemaforo {ip} {accion}',
    is_enabled          boolean not null default true,
    created_at          timestamptz not null default now(),
    unique(site_id, code)
);

create table if not exists ds_traffic_command_log (
    id                  bigserial primary key,
    traffic_device_id   bigint not null references ds_traffic_device(id),
    alert_id            bigint references ds_alert(id),
    requested_action    varchar(40) not null,
    command_executed    text not null,
    execution_status    varchar(20) not null default 'pending',
    stdout_text         text,
    stderr_text         text,
    requested_at        timestamptz not null default now(),
    finished_at         timestamptz
);

create index if not exists idx_ds_object_event_object_date on ds_object_state_event(map_object_id, observed_at desc);
create index if not exists idx_ds_alert_site_opened on ds_alert(site_id, opened_at desc);
create index if not exists idx_ds_screen_site_status on ds_screen(site_id, status_code);

insert into ds_company(code, name)
values ('codelco', 'Codelco'), ('telemining', 'Telemining')
on conflict (code) do nothing;

insert into ds_site(company_id, code, name, description)
select c.id, 'andes_norte', 'Andes Norte', 'Site sísmico Andes Norte'
from ds_company c
where c.code = 'codelco'
on conflict (company_id, code) do nothing;

insert into ds_site(company_id, code, name, description)
select c.id, 'diamante', 'Diamante', 'Site sísmico Diamante'
from ds_company c
where c.code = 'codelco'
on conflict (company_id, code) do nothing;

insert into ds_state_catalog(code, display_name, severity, color_hex, requires_attention, is_blocking)
values
('normal', 'Normal', 0, '#16a34a', false, false),
('warning', 'Advertencia', 1, '#eab308', true, false),
('critical', 'Crítico', 2, '#dc2626', true, true),
('offline', 'Offline', 3, '#64748b', true, false)
on conflict (code) do nothing;

insert into ds_site_map(site_id, code, name, background_image, width_px, height_px, version_label)
select s.id, 'andes_norte_main', 'Plano Andes Norte', '/sismico/img/MAP-AN.jpg', 1920, 1080, 'v1'
from ds_site s where s.code='andes_norte'
on conflict (site_id, code) do nothing;

insert into ds_site_map(site_id, code, name, background_image, width_px, height_px, version_label)
select s.id, 'diamante_main', 'Plano Diamante', '/sismico/img/d.jpg', 1920, 1080, 'v1'
from ds_site s where s.code='diamante'
on conflict (site_id, code) do nothing;

insert into ds_map_object(site_map_id, code, name, object_type, geometry_type, geometry_json, sort_order)
select m.id, 'MONITOREO_POST_EVENTO', 'Monitoreo Post Evento', 'polygon', 'rect',
'{"x":22,"y":18,"w":18,"h":14}'::jsonb, 10
from ds_site_map m where m.code='andes_norte_main'
on conflict (site_map_id, code) do nothing;

insert into ds_map_object(site_map_id, code, name, object_type, geometry_type, geometry_json, sort_order)
select m.id, 'ADIT_74_75', 'Adit 74 - 75', 'polygon', 'rect',
'{"x":46,"y":20,"w":14,"h":12}'::jsonb, 20
from ds_site_map m where m.code='andes_norte_main'
on conflict (site_map_id, code) do nothing;

insert into ds_map_object(site_map_id, code, name, object_type, geometry_type, geometry_json, sort_order)
select m.id, 'P_4600', 'P 4600', 'polygon', 'rect',
'{"x":63,"y":35,"w":15,"h":15}'::jsonb, 30
from ds_site_map m where m.code='andes_norte_main'
on conflict (site_map_id, code) do nothing;

insert into ds_map_object(site_map_id, code, name, object_type, geometry_type, geometry_json, sort_order)
select m.id, 'POLIGONO_PILAR_2', 'Polígono Pilar 2', 'polygon', 'rect',
'{"x":35,"y":52,"w":18,"h":13}'::jsonb, 40
from ds_site_map m where m.code='andes_norte_main'
on conflict (site_map_id, code) do nothing;

insert into ds_map_object(site_map_id, code, name, object_type, geometry_type, geometry_json, sort_order)
select m.id, 'INICIO_CAVING', 'Inicio Caving', 'polygon', 'rect',
'{"x":58,"y":60,"w":18,"h":13}'::jsonb, 50
from ds_site_map m where m.code='andes_norte_main'
on conflict (site_map_id, code) do nothing;

insert into ds_map_object(site_map_id, code, name, object_type, geometry_type, geometry_json, sort_order)
select m.id, 'BDE', 'Bajo Diamante Esmeralda', 'polygon', 'rect',
'{"x":44,"y":38,"w":20,"h":18}'::jsonb, 10
from ds_site_map m where m.code='diamante_main'
on conflict (site_map_id, code) do nothing;

insert into ds_object_current_state(map_object_id, state_id, source_origin, metadata)
select o.id, s.id, 'seed', '{}'::jsonb
from ds_map_object o
join ds_state_catalog s on s.code = case
    when o.code in ('POLIGONO_PILAR_2', 'BDE') then 'critical'
    when o.code = 'ADIT_74_75' then 'warning'
    else 'normal'
end
on conflict (map_object_id) do nothing;

insert into ds_screen(site_id, site_map_id, code, name, current_url, status_code, last_heartbeat_at)
select s.id, m.id, 'an_wall_01', 'Andes Norte Wall 01', '/sismico?site=andes_norte', 'online', now() - interval '11 seconds'
from ds_site s join ds_site_map m on m.site_id=s.id and m.code='andes_norte_main'
where s.code='andes_norte'
on conflict (site_id, code) do nothing;

insert into ds_screen(site_id, site_map_id, code, name, current_url, status_code, last_heartbeat_at)
select s.id, m.id, 'an_wall_02', 'Andes Norte Wall 02', '/sismico?site=andes_norte', 'online', now() - interval '22 seconds'
from ds_site s join ds_site_map m on m.site_id=s.id and m.code='andes_norte_main'
where s.code='andes_norte'
on conflict (site_id, code) do nothing;

insert into ds_screen(site_id, site_map_id, code, name, current_url, status_code, last_heartbeat_at)
select s.id, m.id, 'dia_wall_01', 'Diamante Wall 01', '/sismico?site=diamante', 'offline', now() - interval '366 seconds'
from ds_site s join ds_site_map m on m.site_id=s.id and m.code='diamante_main'
where s.code='diamante'
on conflict (site_id, code) do nothing;

insert into ds_remote_source(site_id, code, name, source_type, base_url)
select s.id, 'andes_hdis', 'Andes HDIS', 'html', 'http://10.18.18.83'
from ds_site s where s.code='andes_norte'
on conflict (code) do nothing;

insert into ds_remote_source(site_id, code, name, source_type, base_url)
select s.id, 'diamante_hdis', 'Diamante HDIS', 'html', 'http://10.18.18.83'
from ds_site s where s.code='diamante'
on conflict (code) do nothing;

insert into ds_remote_endpoint(remote_source_id, site_id, code, name, endpoint_url, endpoint_kind, parser_type, polling_seconds)
select rs.id, rs.site_id, 'andes_8001', 'Andes Norte Resumen', 'http://10.18.18.83:8001/hdis1/resumen/', 'html_table', 'html_scraper', 10
from ds_remote_source rs where rs.code='andes_hdis'
on conflict (code) do nothing;

insert into ds_remote_endpoint(remote_source_id, site_id, code, name, endpoint_url, endpoint_kind, parser_type, polling_seconds)
select rs.id, rs.site_id, 'andes_8008', 'Andes Norte Inicio Caving', 'http://10.18.18.83:8008/hdis1/resumen/', 'html_table', 'html_scraper', 10
from ds_remote_source rs where rs.code='andes_hdis'
on conflict (code) do nothing;

insert into ds_remote_endpoint(remote_source_id, site_id, code, name, endpoint_url, endpoint_kind, parser_type, polling_seconds)
select rs.id, rs.site_id, 'diamante_8001', 'Diamante Resumen', 'http://10.18.18.83:8001/hdis1/resumen/', 'html_table', 'html_scraper', 10
from ds_remote_source rs where rs.code='diamante_hdis'
on conflict (code) do nothing;

insert into ds_alert(site_id, map_object_id, severity_code, title, message, status, opened_at)
select s.id, o.id, 'critical', 'Polígono Pilar 2 en estado crítico', 'Evento crítico con acción semafórica sugerida', 'open', now() - interval '8 minutes'
from ds_site s
join ds_site_map m on m.site_id = s.id and m.code='andes_norte_main'
join ds_map_object o on o.site_map_id = m.id and o.code='POLIGONO_PILAR_2'
where s.code='andes_norte'
on conflict do nothing;

insert into ds_traffic_device(site_id, code, name, ip_address, command_template)
select s.id, 'SEM_AN_01', 'Semáforo Andes Norte 01', '10.10.20.11', 'ipsemaforo {ip} {accion}'
from ds_site s where s.code='andes_norte'
on conflict (site_id, code) do nothing;

insert into ds_traffic_command_log(traffic_device_id, alert_id, requested_action, command_executed, execution_status, requested_at, finished_at)
select d.id, a.id, 'rojo', 'ipsemaforo 10.10.20.11 rojo', 'success', now() - interval '8 minutes', now() - interval '8 minutes' + interval '2 seconds'
from ds_traffic_device d
join ds_alert a on a.site_id = d.site_id
where d.code='SEM_AN_01'
limit 1;
