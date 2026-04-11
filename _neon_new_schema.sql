Unable to find image 'postgres:17-alpine' locally
17-alpine: Pulling from library/postgres
f2a415485be8: Pulling fs layer
fdf62960cfa4: Pulling fs layer
53b97f3e412f: Pulling fs layer
1ef1ea9c64ed: Pulling fs layer
55e10658d957: Pulling fs layer
bf295aa7a64c: Pulling fs layer
9dbf78af1c87: Pulling fs layer
6b36925b3510: Pulling fs layer
047b0b089519: Pulling fs layer
42108e980ed9: Download complete
016d2f4d0968: Download complete
f2a415485be8: Download complete
fdf62960cfa4: Download complete
53b97f3e412f: Download complete
bf295aa7a64c: Download complete
9dbf78af1c87: Download complete
047b0b089519: Download complete
1ef1ea9c64ed: Download complete
bf295aa7a64c: Pull complete
6b36925b3510: Download complete
fdf62960cfa4: Pull complete
6b36925b3510: Pull complete
55e10658d957: Download complete
1ef1ea9c64ed: Pull complete
55e10658d957: Pull complete
f2a415485be8: Pull complete
9dbf78af1c87: Pull complete
047b0b089519: Pull complete
53b97f3e412f: Pull complete
Digest: sha256:6f30057d31f5861b66f3545d4821f987aacf1dd920765f0acadea0c58ff975b1
Status: Downloaded newer image for postgres:17-alpine
--
-- PostgreSQL database dump
--

\restrict uwyRF2LG48WhSdO2lhMt1vWkeOLNlQHAeRf6gM3fUmi0BVMwhasKhblP6HQWXc1

-- Dumped from database version 17.8 (a48d9ca)
-- Dumped by pg_dump version 17.9

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: mensajes_archivos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mensajes_archivos (
    id integer NOT NULL,
    mensaje_id integer NOT NULL,
    nombre text NOT NULL,
    tipo text,
    tamano integer,
    contenido bytea
);


--
-- Name: mensajes_archivos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mensajes_archivos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mensajes_archivos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mensajes_archivos_id_seq OWNED BY public.mensajes_archivos.id;


--
-- Name: mensajes_contacto; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mensajes_contacto (
    id integer NOT NULL,
    email text NOT NULL,
    asunto text NOT NULL,
    mensaje text NOT NULL,
    leido boolean DEFAULT false,
    respondido boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: mensajes_contacto_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mensajes_contacto_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mensajes_contacto_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mensajes_contacto_id_seq OWNED BY public.mensajes_contacto.id;


--
-- Name: notas_monumento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notas_monumento (
    id integer NOT NULL,
    bien_id integer NOT NULL,
    usuario_id integer NOT NULL,
    tipo text DEFAULT 'nota'::text,
    texto text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT notas_monumento_tipo_check CHECK ((tipo = ANY (ARRAY['horario'::text, 'precio'::text, 'nota'::text])))
);


--
-- Name: notas_monumento_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notas_monumento_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notas_monumento_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notas_monumento_id_seq OWNED BY public.notas_monumento.id;


--
-- Name: propuestas_imagenes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.propuestas_imagenes (
    id integer NOT NULL,
    propuesta_id integer NOT NULL,
    nombre text NOT NULL,
    tipo text,
    tamano integer,
    contenido bytea,
    url text
);


--
-- Name: propuestas_imagenes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.propuestas_imagenes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: propuestas_imagenes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.propuestas_imagenes_id_seq OWNED BY public.propuestas_imagenes.id;


--
-- Name: propuestas_monumentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.propuestas_monumentos (
    id integer NOT NULL,
    usuario_id integer NOT NULL,
    denominacion text NOT NULL,
    tipo text,
    categoria text,
    provincia text,
    comarca text,
    municipio text,
    localidad text,
    latitud double precision,
    longitud double precision,
    comunidad_autonoma text,
    pais text NOT NULL,
    descripcion text,
    estilo text,
    material text,
    inception text,
    arquitecto text,
    wikipedia_url text,
    estado text DEFAULT 'pendiente'::text,
    notas_admin text,
    revisado_por integer,
    bien_id integer,
    created_at timestamp with time zone DEFAULT now(),
    revisado_at timestamp with time zone,
    CONSTRAINT propuestas_monumentos_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aprobada'::text, 'rechazada'::text])))
);


--
-- Name: propuestas_monumentos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.propuestas_monumentos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: propuestas_monumentos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.propuestas_monumentos_id_seq OWNED BY public.propuestas_monumentos.id;


--
-- Name: rutas_culturales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rutas_culturales (
    id integer NOT NULL,
    slug text NOT NULL,
    nombre text NOT NULL,
    descripcion text,
    region text,
    pais text DEFAULT 'España'::text,
    tema text,
    centro_lat double precision,
    centro_lng double precision,
    zoom integer DEFAULT 10,
    imagen_portada text,
    num_paradas integer DEFAULT 0,
    activa boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: rutas_culturales_fotos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rutas_culturales_fotos (
    id integer NOT NULL,
    parada_id integer NOT NULL,
    url text NOT NULL,
    titulo text,
    orden integer DEFAULT 0,
    autor text,
    fuente text
);


--
-- Name: rutas_culturales_fotos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rutas_culturales_fotos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rutas_culturales_fotos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rutas_culturales_fotos_id_seq OWNED BY public.rutas_culturales_fotos.id;


--
-- Name: rutas_culturales_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rutas_culturales_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rutas_culturales_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rutas_culturales_id_seq OWNED BY public.rutas_culturales.id;


--
-- Name: rutas_culturales_paradas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rutas_culturales_paradas (
    id integer NOT NULL,
    ruta_id integer NOT NULL,
    bien_id integer,
    orden integer NOT NULL,
    nombre text NOT NULL,
    localidad text,
    municipio text,
    latitud double precision,
    longitud double precision,
    descripcion text,
    estilo text,
    periodo text,
    autor text,
    anyo_restauracion text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: rutas_culturales_paradas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rutas_culturales_paradas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rutas_culturales_paradas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rutas_culturales_paradas_id_seq OWNED BY public.rutas_culturales_paradas.id;


--
-- Name: rutas_paradas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rutas_paradas (
    id integer NOT NULL,
    ruta_id integer NOT NULL,
    bien_id integer NOT NULL,
    orden integer NOT NULL,
    notas text
);


--
-- Name: rutas_paradas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rutas_paradas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rutas_paradas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rutas_paradas_id_seq OWNED BY public.rutas_paradas.id;


--
-- Name: rutas_usuario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rutas_usuario (
    id integer NOT NULL,
    usuario_id integer NOT NULL,
    nombre text NOT NULL,
    centro_lat double precision,
    centro_lng double precision,
    radio_km integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: rutas_usuario_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rutas_usuario_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rutas_usuario_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rutas_usuario_id_seq OWNED BY public.rutas_usuario.id;


--
-- Name: social_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.social_history (
    id integer NOT NULL,
    bien_id integer NOT NULL,
    platform text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: social_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.social_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: social_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.social_history_id_seq OWNED BY public.social_history.id;


--
-- Name: valoraciones_monumento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.valoraciones_monumento (
    id integer NOT NULL,
    bien_id integer NOT NULL,
    usuario_id integer NOT NULL,
    general integer NOT NULL,
    conservacion integer,
    accesibilidad integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT valoraciones_monumento_accesibilidad_check CHECK (((accesibilidad >= 1) AND (accesibilidad <= 5))),
    CONSTRAINT valoraciones_monumento_conservacion_check CHECK (((conservacion >= 1) AND (conservacion <= 5))),
    CONSTRAINT valoraciones_monumento_general_check CHECK (((general >= 1) AND (general <= 5)))
);


--
-- Name: valoraciones_monumento_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.valoraciones_monumento_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: valoraciones_monumento_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.valoraciones_monumento_id_seq OWNED BY public.valoraciones_monumento.id;


--
-- Name: mensajes_archivos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensajes_archivos ALTER COLUMN id SET DEFAULT nextval('public.mensajes_archivos_id_seq'::regclass);


--
-- Name: mensajes_contacto id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensajes_contacto ALTER COLUMN id SET DEFAULT nextval('public.mensajes_contacto_id_seq'::regclass);


--
-- Name: notas_monumento id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_monumento ALTER COLUMN id SET DEFAULT nextval('public.notas_monumento_id_seq'::regclass);


--
-- Name: propuestas_imagenes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.propuestas_imagenes ALTER COLUMN id SET DEFAULT nextval('public.propuestas_imagenes_id_seq'::regclass);


--
-- Name: propuestas_monumentos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.propuestas_monumentos ALTER COLUMN id SET DEFAULT nextval('public.propuestas_monumentos_id_seq'::regclass);


--
-- Name: rutas_culturales id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rutas_culturales ALTER COLUMN id SET DEFAULT nextval('public.rutas_culturales_id_seq'::regclass);


--
-- Name: rutas_culturales_fotos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rutas_culturales_fotos ALTER COLUMN id SET DEFAULT nextval('public.rutas_culturales_fotos_id_seq'::regclass);


--
-- Name: rutas_culturales_paradas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rutas_culturales_paradas ALTER COLUMN id SET DEFAULT nextval('public.rutas_culturales_paradas_id_seq'::regclass);


--
-- Name: rutas_paradas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rutas_paradas ALTER COLUMN id SET DEFAULT nextval('public.rutas_paradas_id_seq'::regclass);


--
-- Name: rutas_usuario id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rutas_usuario ALTER COLUMN id SET DEFAULT nextval('public.rutas_usuario_id_seq'::regclass);


--
-- Name: social_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_history ALTER COLUMN id SET DEFAULT nextval('public.social_history_id_seq'::regclass);


--
-- Name: valoraciones_monumento id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.valoraciones_monumento ALTER COLUMN id SET DEFAULT nextval('public.valoraciones_monumento_id_seq'::regclass);


--
-- Name: mensajes_archivos mensajes_archivos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensajes_archivos
    ADD CONSTRAINT mensajes_archivos_pkey PRIMARY KEY (id);


--
-- Name: mensajes_contacto mensajes_contacto_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensajes_contacto
    ADD CONSTRAINT mensajes_contacto_pkey PRIMARY KEY (id);


--
-- Name: notas_monumento notas_monumento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_monumento
    ADD CONSTRAINT notas_monumento_pkey PRIMARY KEY (id);


--
-- Name: propuestas_imagenes propuestas_imagenes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.propuestas_imagenes
    ADD CONSTRAINT propuestas_imagenes_pkey PRIMARY KEY (id);


--
-- Name: propuestas_monumentos propuestas_monumentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.propuestas_monumentos
    ADD CONSTRAINT propuestas_monumentos_pkey PRIMARY KEY (id);


--
-- Name: rutas_culturales_fotos rutas_culturales_fotos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rutas_culturales_fotos
    ADD CONSTRAINT rutas_culturales_fotos_pkey PRIMARY KEY (id);


--
-- Name: rutas_culturales_paradas rutas_culturales_paradas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rutas_culturales_paradas
    ADD CONSTRAINT rutas_culturales_paradas_pkey PRIMARY KEY (id);


--
-- Name: rutas_culturales rutas_culturales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rutas_culturales
    ADD CONSTRAINT rutas_culturales_pkey PRIMARY KEY (id);


--
-- Name: rutas_culturales rutas_culturales_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rutas_culturales
    ADD CONSTRAINT rutas_culturales_slug_key UNIQUE (slug);


--
-- Name: rutas_paradas rutas_paradas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rutas_paradas
    ADD CONSTRAINT rutas_paradas_pkey PRIMARY KEY (id);


--
-- Name: rutas_usuario rutas_usuario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rutas_usuario
    ADD CONSTRAINT rutas_usuario_pkey PRIMARY KEY (id);


--
-- Name: social_history social_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_history
    ADD CONSTRAINT social_history_pkey PRIMARY KEY (id);


--
-- Name: valoraciones_monumento valoraciones_monumento_bien_id_usuario_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.valoraciones_monumento
    ADD CONSTRAINT valoraciones_monumento_bien_id_usuario_id_key UNIQUE (bien_id, usuario_id);


--
-- Name: valoraciones_monumento valoraciones_monumento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.valoraciones_monumento
    ADD CONSTRAINT valoraciones_monumento_pkey PRIMARY KEY (id);


--
-- Name: idx_mensajes_archivos_msg; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mensajes_archivos_msg ON public.mensajes_archivos USING btree (mensaje_id);


--
-- Name: idx_mensajes_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mensajes_created ON public.mensajes_contacto USING btree (created_at DESC);


--
-- Name: idx_notas_monumento_bien; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notas_monumento_bien ON public.notas_monumento USING btree (bien_id);


--
-- Name: idx_notas_monumento_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notas_monumento_usuario ON public.notas_monumento USING btree (usuario_id);


--
-- Name: idx_propuestas_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_propuestas_estado ON public.propuestas_monumentos USING btree (estado);


--
-- Name: idx_propuestas_imagenes_prop; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_propuestas_imagenes_prop ON public.propuestas_imagenes USING btree (propuesta_id);


--
-- Name: idx_propuestas_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_propuestas_usuario ON public.propuestas_monumentos USING btree (usuario_id);


--
-- Name: idx_rc_fotos_parada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rc_fotos_parada ON public.rutas_culturales_fotos USING btree (parada_id);


--
-- Name: idx_rc_paradas_bien; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rc_paradas_bien ON public.rutas_culturales_paradas USING btree (bien_id);


--
-- Name: idx_rc_paradas_ruta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rc_paradas_ruta ON public.rutas_culturales_paradas USING btree (ruta_id);


--
-- Name: idx_rc_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rc_slug ON public.rutas_culturales USING btree (slug);


--
-- Name: idx_rutas_paradas_bien; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rutas_paradas_bien ON public.rutas_paradas USING btree (bien_id);


--
-- Name: idx_rutas_paradas_ruta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rutas_paradas_ruta ON public.rutas_paradas USING btree (ruta_id);


--
-- Name: idx_rutas_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rutas_usuario ON public.rutas_usuario USING btree (usuario_id);


--
-- Name: idx_social_history_bien; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_history_bien ON public.social_history USING btree (bien_id);


--
-- Name: idx_social_history_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_history_created ON public.social_history USING btree (created_at);


--
-- Name: idx_valoraciones_bien; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_valoraciones_bien ON public.valoraciones_monumento USING btree (bien_id);


--
-- Name: idx_valoraciones_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_valoraciones_usuario ON public.valoraciones_monumento USING btree (usuario_id);


--
-- Name: mensajes_archivos mensajes_archivos_mensaje_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensajes_archivos
    ADD CONSTRAINT mensajes_archivos_mensaje_id_fkey FOREIGN KEY (mensaje_id) REFERENCES public.mensajes_contacto(id) ON DELETE CASCADE;


--
-- Name: notas_monumento notas_monumento_bien_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_monumento
    ADD CONSTRAINT notas_monumento_bien_id_fkey FOREIGN KEY (bien_id) REFERENCES public.bienes(id) ON DELETE CASCADE;


--
-- Name: notas_monumento notas_monumento_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_monumento
    ADD CONSTRAINT notas_monumento_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: propuestas_imagenes propuestas_imagenes_propuesta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.propuestas_imagenes
    ADD CONSTRAINT propuestas_imagenes_propuesta_id_fkey FOREIGN KEY (propuesta_id) REFERENCES public.propuestas_monumentos(id) ON DELETE CASCADE;


--
-- Name: propuestas_monumentos propuestas_monumentos_bien_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.propuestas_monumentos
    ADD CONSTRAINT propuestas_monumentos_bien_id_fkey FOREIGN KEY (bien_id) REFERENCES public.bienes(id);


--
-- Name: propuestas_monumentos propuestas_monumentos_revisado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.propuestas_monumentos
    ADD CONSTRAINT propuestas_monumentos_revisado_por_fkey FOREIGN KEY (revisado_por) REFERENCES public.usuarios(id);


--
-- Name: propuestas_monumentos propuestas_monumentos_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.propuestas_monumentos
    ADD CONSTRAINT propuestas_monumentos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: rutas_culturales_fotos rutas_culturales_fotos_parada_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rutas_culturales_fotos
    ADD CONSTRAINT rutas_culturales_fotos_parada_id_fkey FOREIGN KEY (parada_id) REFERENCES public.rutas_culturales_paradas(id) ON DELETE CASCADE;


--
-- Name: rutas_culturales_paradas rutas_culturales_paradas_bien_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rutas_culturales_paradas
    ADD CONSTRAINT rutas_culturales_paradas_bien_id_fkey FOREIGN KEY (bien_id) REFERENCES public.bienes(id);


--
-- Name: rutas_culturales_paradas rutas_culturales_paradas_ruta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rutas_culturales_paradas
    ADD CONSTRAINT rutas_culturales_paradas_ruta_id_fkey FOREIGN KEY (ruta_id) REFERENCES public.rutas_culturales(id) ON DELETE CASCADE;


--
-- Name: rutas_paradas rutas_paradas_bien_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rutas_paradas
    ADD CONSTRAINT rutas_paradas_bien_id_fkey FOREIGN KEY (bien_id) REFERENCES public.bienes(id) ON DELETE CASCADE;


--
-- Name: rutas_paradas rutas_paradas_ruta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rutas_paradas
    ADD CONSTRAINT rutas_paradas_ruta_id_fkey FOREIGN KEY (ruta_id) REFERENCES public.rutas_usuario(id) ON DELETE CASCADE;


--
-- Name: rutas_usuario rutas_usuario_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rutas_usuario
    ADD CONSTRAINT rutas_usuario_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: social_history social_history_bien_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_history
    ADD CONSTRAINT social_history_bien_id_fkey FOREIGN KEY (bien_id) REFERENCES public.bienes(id) ON DELETE CASCADE;


--
-- Name: valoraciones_monumento valoraciones_monumento_bien_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.valoraciones_monumento
    ADD CONSTRAINT valoraciones_monumento_bien_id_fkey FOREIGN KEY (bien_id) REFERENCES public.bienes(id) ON DELETE CASCADE;


--
-- Name: valoraciones_monumento valoraciones_monumento_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.valoraciones_monumento
    ADD CONSTRAINT valoraciones_monumento_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict uwyRF2LG48WhSdO2lhMt1vWkeOLNlQHAeRf6gM3fUmi0BVMwhasKhblP6HQWXc1

