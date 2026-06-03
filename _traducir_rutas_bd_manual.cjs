/**
 * Inserta traducciones manuales (it, pt, gl, eu) para rutas_culturales.
 * Idempotente via ON CONFLICT UPDATE.
 *
 * Las traducciones están embebidas en este archivo (curadas a mano por Claude).
 * Mantiene nombres propios (Via Francigena, Camino del Cid, UNESCO, Vauban...).
 */
require('dotenv').config();
const { Pool } = require('pg');

const T = {
  // id 1 — Retablos Renacentistas del Este de León
  1: {
    it: { nombre: "Pale Rinascimentali dell'Est di León", descripcion: "Itinerario tra dieci splendide pale d'altare rinascimentali e gotiche conservate nelle chiese dell'est della provincia di León, tra la Tierra de Sahagún e la Montaña de Riaño. Un viaggio nell'arte sacra dei secoli XV e XVI, con opere di scultori come Guillén Doncel e pittori come Cristóbal de Colmenares, che mostrano la ricchezza artistica del patrimonio religioso leonese." },
    pt: { nombre: "Retábulos Renascentistas do Leste de León", descripcion: "Percurso por dez esplêndidos retábulos renascentistas e góticos preservados em igrejas do leste da província de León, entre a Tierra de Sahagún e a Montaña de Riaño. Uma viagem pela arte sacra dos séculos XV e XVI, com obras de imaginários como Guillén Doncel e pintores como Cristóbal de Colmenares, que mostram a riqueza artística do património religioso leonês." },
    gl: { nombre: "Retablos Renacentistas do Leste de León", descripcion: "Percorrido por dez espléndidos retablos renacentistas e góticos conservados en igrexas do leste da provincia de León, entre a Terra de Sahagún e a Montaña de Riaño. Unha viaxe pola arte sacra dos séculos XV e XVI, con obras de imaxineiros como Guillén Doncel e pintores como Cristóbal de Colmenares, que amosan a riqueza artística do patrimonio relixioso leonés." },
    eu: { nombre: "Leongo Ekialdeko Erretaula Errenazentistak", descripcion: "Leongo probintziaren ekialdeko elizetan kontserbatzen diren hamar erretaula errenazentista eta gotiko ezin ederragoetan zeharreko ibilbidea, Sahagún Lurraren eta Riañoko Mendiaren artean. XV. eta XVI. mendeetako arte sakratuari egindako bidaia, Guillén Doncel bezalako irudigileen eta Cristóbal de Colmenares bezalako margolarien obrekin, Leongo ondare erlijiosoaren aberastasun artistikoa erakusten dutenak." },
  },
  2: {
    it: { nombre: "Via degli Dei", descripcion: "percorso escursionistico in Italia" },
    pt: { nombre: "Via degli Dei", descripcion: "percurso pedestre em Itália" },
    gl: { nombre: "Via degli Dei", descripcion: "ruta de sendeirismo en Italia" },
    eu: { nombre: "Via degli Dei", descripcion: "Italiako ibilaldi-ibilbidea" },
  },
  3: {
    it: { nombre: "Sentiero del Viandante", descripcion: "percorso escursionistico del Lago di Como" },
    pt: { nombre: "Sentiero del Viandante", descripcion: "percurso pedestre do Lago de Como" },
    gl: { nombre: "Sentiero del Viandante", descripcion: "ruta de sendeirismo do Lago de Como" },
    eu: { nombre: "Sentiero del Viandante", descripcion: "Como aintziraren ibilaldi-ibilbidea" },
  },
  4: {
    it: { nombre: "Levada das 25 Fontes", descripcion: "levada a Rabaçal, Madeira, Portogallo" },
    pt: { nombre: "Levada das 25 Fontes", descripcion: "levada no Rabaçal, Madeira, Portugal" },
    gl: { nombre: "Levada das 25 Fontes", descripcion: "levada no Rabaçal, Madeira, Portugal" },
    eu: { nombre: "Levada das 25 Fontes", descripcion: "Rabaçaleko levada, Madeira, Portugal" },
  },
  5: {
    it: { nombre: "Caminho Real do Paul do Mar", descripcion: "percorso pedonale sull'isola di Madeira, Portogallo" },
    pt: { nombre: "Caminho Real do Paul do Mar", descripcion: "percurso pedestre na ilha da Madeira, Portugal" },
    gl: { nombre: "Caminho Real do Paul do Mar", descripcion: "percorrido peonil na illa da Madeira, Portugal" },
    eu: { nombre: "Caminho Real do Paul do Mar", descripcion: "Madeira uharteko ibilaldi-bidea, Portugal" },
  },
  6: {
    it: { nombre: "Via Mercatorum", descripcion: "insieme di sentieri e mulattiere in provincia di Bergamo" },
    pt: { nombre: "Via Mercatorum", descripcion: "conjunto de trilhos e caminhos de mulas na província de Bérgamo" },
    gl: { nombre: "Via Mercatorum", descripcion: "conxunto de sendeiros e camiños de mulas na provincia de Bérgamo" },
    eu: { nombre: "Via Mercatorum", descripcion: "Bergamoko probintziako bidexka eta mando-bideen multzoa" },
  },
  9: {
    it: { nombre: "Ruta del Cares", descripcion: "percorso escursionistico del nord della Spagna situato tra la provincia di León e Asturie, nei Picos de Europa" },
    pt: { nombre: "Ruta del Cares", descripcion: "rota pedestre do norte de Espanha situada entre a província de León e as Astúrias, nos Picos de Europa" },
    gl: { nombre: "Ruta do Cares", descripcion: "ruta de sendeirismo do norte de España situada entre a provincia de León e Asturias, nos Picos de Europa" },
    eu: { nombre: "Cares Ibilbidea", descripcion: "Espainia iparraldeko ibilaldi-ibilbidea, Leongo probintziaren eta Asturiasen artean kokatua, Europako Mendietan" },
  },
  10: {
    it: { nombre: "Sentiero Crémont", descripcion: "sentiero escursionistico dell'isola della Riunione" },
    pt: { nombre: "Caminho Crémont", descripcion: "trilho pedestre da ilha de La Réunion" },
    gl: { nombre: "Camiño Crémont", descripcion: "sendeiro de sendeirismo da illa da Reunión" },
    eu: { nombre: "Crémont bidea", descripcion: "Réunion uharteko ibilaldi-bidexka" },
  },
  11: {
    it: { nombre: "Via Spluga", descripcion: "itinerario culturale in Svizzera" },
    pt: { nombre: "Via Spluga", descripcion: "rota cultural na Suíça" },
    gl: { nombre: "Via Spluga", descripcion: "ruta cultural en Suíza" },
    eu: { nombre: "Via Spluga", descripcion: "Suitzako ibilbide kulturala" },
  },
  12: {
    it: { nombre: "Via dell'Amore", descripcion: "sentiero pedonale in Liguria, Italia" },
    pt: { nombre: "Via dell'Amore", descripcion: "caminho pedestre na Ligúria, Itália" },
    gl: { nombre: "Via dell'Amore", descripcion: "sendeiro peonil na Liguria, Italia" },
    eu: { nombre: "Via dell'Amore", descripcion: "Liguriako oinezkoentzako bidea, Italia" },
  },
  13: {
    it: { nombre: "Caminito del Rey", descripcion: "passaggio pedonale in Spagna" },
    pt: { nombre: "Caminito del Rey", descripcion: "passagem pedestre em Espanha" },
    gl: { nombre: "Caminito del Rey", descripcion: "pasaxe peonil en España" },
    eu: { nombre: "Caminito del Rey", descripcion: "Espainiako oinezkoentzako pasagunea" },
  },
  14: {
    it: { nombre: "Sentiero dei Fiori", descripcion: "percorso escursionistico nelle Prealpi Orobie" },
    pt: { nombre: "Sentiero dei Fiori", descripcion: "percurso pedestre nos Pré-Alpes Oróbicos" },
    gl: { nombre: "Sentiero dei Fiori", descripcion: "ruta de sendeirismo nos Prealpes Oróbicos" },
    eu: { nombre: "Sentiero dei Fiori", descripcion: "Prealpe Oróbikoetako ibilaldi-ibilbidea" },
  },
  15: {
    it: { nombre: "Percorso dei Sette Valli Sospesi", descripcion: "percorso escursionistico lungo la costa" },
    pt: { nombre: "Percurso dos Sete Vales Suspensos", descripcion: "percurso pedestre ao longo da costa" },
    gl: { nombre: "Percorrido dos Sete Vales Suspendidos", descripcion: "ruta de sendeirismo ao longo da costa" },
    eu: { nombre: "Zazpi Haran Esekien Ibilbidea", descripcion: "kostaldean zeharreko ibilaldi-ibilbidea" },
  },
  16: {
    it: { nombre: "Sentiero Rilke", descripcion: "sentiero di Duino-Aurisina" },
    pt: { nombre: "Sentiero Rilke", descripcion: "trilho de Duino-Aurisina" },
    gl: { nombre: "Sendeiro Rilke", descripcion: "sendeiro de Duino-Aurisina" },
    eu: { nombre: "Rilke Bidea", descripcion: "Duino-Aurisinako bidexka" },
  },
  17: {
    it: { nombre: "Sentiero delle Ripe", descripcion: "sentiero di Muro Lucano" },
    pt: { nombre: "Sentiero delle Ripe", descripcion: "trilho de Muro Lucano" },
    gl: { nombre: "Sendeiro das Ripe", descripcion: "sendeiro de Muro Lucano" },
    eu: { nombre: "Sentiero delle Ripe", descripcion: "Muro Lucanoko bidexka" },
  },
  18: {
    it: { nombre: "Sentiero dei Grandi Alberi", descripcion: "percorso escursionistico a Recoaro Terme" },
    pt: { nombre: "Sentiero dei Grandi Alberi", descripcion: "percurso pedestre em Recoaro Terme" },
    gl: { nombre: "Sendeiro dos Grandes Árbores", descripcion: "ruta de sendeirismo en Recoaro Terme" },
    eu: { nombre: "Zuhaitz Handien Bidea", descripcion: "Recoaro Termeko ibilaldi-ibilbidea" },
  },
  19: {
    it: { nombre: "Sentiero Sortie Vallée Blanche", descripcion: "sentiero escursionistico in Francia" },
    pt: { nombre: "Caminho Sortie Vallée Blanche", descripcion: "trilho pedestre em França" },
    gl: { nombre: "Camiño Sortie Vallée Blanche", descripcion: "sendeiro de sendeirismo en Francia" },
    eu: { nombre: "Sortie Vallée Blanche bidea", descripcion: "Frantziako ibilaldi-bidexka" },
  },
  20: {
    it: { nombre: "Cammino Francese – Via Romanica", descripcion: null },
    pt: { nombre: "Caminho Francês – Rota Românica", descripcion: null },
    gl: { nombre: "Camiño Francés – Ruta Románica", descripcion: null },
    eu: { nombre: "Bide Frantsesa – Ibilbide Erromanikoa", descripcion: null },
  },
  21: {
    it: { nombre: "Vall de Boí – Romanico Lombardo UNESCO", descripcion: null },
    pt: { nombre: "Vall de Boí – Românico Lombardo UNESCO", descripcion: null },
    gl: { nombre: "Val de Boí – Románico Lombardo UNESCO", descripcion: null },
    eu: { nombre: "Boí Harana – Erromaniko Lombardiarra UNESCO", descripcion: null },
  },
  22: {
    it: { nombre: "Romanico di Palencia", descripcion: null },
    pt: { nombre: "Românico de Palencia", descripcion: null },
    gl: { nombre: "Románico Palentino", descripcion: null },
    eu: { nombre: "Palentziako Erromanikoa", descripcion: null },
  },
  23: {
    it: { nombre: "Romanico Aragonese – Jacetania e Serrablo", descripcion: null },
    pt: { nombre: "Românico Aragonês – Jacetania e Serrablo", descripcion: null },
    gl: { nombre: "Románico Aragonés – Jacetania e Serrablo", descripcion: null },
    eu: { nombre: "Aragoiko Erromanikoa – Jacetania eta Serrablo", descripcion: null },
  },
  24: {
    it: { nombre: "Romanico Cantabrico – Cammino del Nord", descripcion: null },
    pt: { nombre: "Românico Cantábrico – Caminho do Norte", descripcion: null },
    gl: { nombre: "Románico Cantábrico – Camiño do Norte", descripcion: null },
    eu: { nombre: "Kantauriko Erromanikoa – Iparraldeko Bidea", descripcion: null },
  },
  25: {
    it: { nombre: "Romanico di Soria", descripcion: null },
    pt: { nombre: "Românico de Sória", descripcion: null },
    gl: { nombre: "Románico de Soria", descripcion: null },
    eu: { nombre: "Soriako Erromanikoa", descripcion: null },
  },
  26: {
    it: { nombre: "Grandi Cattedrali Gotiche di Francia", descripcion: null },
    pt: { nombre: "Grandes Catedrais Góticas de França", descripcion: null },
    gl: { nombre: "Grandes Catedrais Góticas de Francia", descripcion: null },
    eu: { nombre: "Frantziako Katedral Gotiko Handiak", descripcion: null },
  },
  27: {
    it: { nombre: "Gotico Levantino – Valencia", descripcion: null },
    pt: { nombre: "Gótico Levantino – Valência", descripcion: null },
    gl: { nombre: "Gótico Levantino – Valencia", descripcion: null },
    eu: { nombre: "Levantear Gotikoa – Valentzia", descripcion: null },
  },
  28: {
    it: { nombre: "Tre Cattedrali Gotiche di Castiglia", descripcion: null },
    pt: { nombre: "Três Catedrais Góticas de Castela", descripcion: null },
    gl: { nombre: "Tres Catedrais Góticas de Castela", descripcion: null },
    eu: { nombre: "Gaztelako Hiru Katedral Gotikoak", descripcion: null },
  },
  29: {
    it: { nombre: "Mudéjar Aragonese – Patrimonio UNESCO", descripcion: null },
    pt: { nombre: "Mudéjar Aragonês – Património UNESCO", descripcion: null },
    gl: { nombre: "Mudéxar Aragonés – Patrimonio UNESCO", descripcion: null },
    eu: { nombre: "Aragoiko Mudejarra – UNESCO Ondarea", descripcion: null },
  },
  30: {
    it: { nombre: "Rinascimento Andaluso – Úbeda e Baeza UNESCO", descripcion: null },
    pt: { nombre: "Renascimento Andaluz – Úbeda e Baeza UNESCO", descripcion: null },
    gl: { nombre: "Renacemento Andaluz – Úbeda e Baeza UNESCO", descripcion: null },
    eu: { nombre: "Andaluziako Errenazimentua – Úbeda eta Baeza UNESCO", descripcion: null },
  },
  31: {
    it: { nombre: "Barocco Churrigueresco – Salamanca", descripcion: null },
    pt: { nombre: "Barroco Churrigueresco – Salamanca", descripcion: null },
    gl: { nombre: "Barroco Churrigueresco – Salamanca", descripcion: null },
    eu: { nombre: "Barroko Txurriguereskoa – Salamanca", descripcion: null },
  },
  32: {
    it: { nombre: "Itinerario Cistercense – Catalogna", descripcion: null },
    pt: { nombre: "Rota Cisterciense – Catalunha", descripcion: null },
    gl: { nombre: "Ruta do Cister – Cataluña", descripcion: null },
    eu: { nombre: "Zisterzieren Ibilbidea – Katalunia", descripcion: null },
  },
  33: {
    it: { nombre: "Itinerario dei Monasteri – Portogallo UNESCO", descripcion: null },
    pt: { nombre: "Rota dos Mosteiros – Portugal UNESCO", descripcion: null },
    gl: { nombre: "Ruta dos Mosteiros – Portugal UNESCO", descripcion: null },
    eu: { nombre: "Monasterioen Ibilbidea – Portugal UNESCO", descripcion: null },
  },
  34: {
    it: { nombre: "Abbazie di Normandia", descripcion: null },
    pt: { nombre: "Abadias da Normandia", descripcion: null },
    gl: { nombre: "Abadías de Normandía", descripcion: null },
    eu: { nombre: "Normandiako Abadiak", descripcion: null },
  },
  35: {
    it: { nombre: "Castelli della Valle della Loira – Itinerario dei Castelli", descripcion: "I castelli rinascimentali più spettacolari di Francia lungo il fiume Loira" },
    pt: { nombre: "Châteaux do Vale do Loire – Rota dos Castelos", descripcion: "Os castelos renascentistas mais espectaculares de França ao longo do rio Loire" },
    gl: { nombre: "Châteaux do Val do Loira – Ruta dos Castelos", descripcion: "Os castelos renacentistas máis espectaculares de Francia ao longo do río Loira" },
    eu: { nombre: "Loira Haraneko Châteaux – Gazteluen Ibilbidea", descripcion: "Loira ibaiaren ibilguan zehar dauden Frantziako gaztelu errenazentista ikusgarrienak" },
  },
  36: {
    it: { nombre: "Castelli Catari – Linguadoca", descripcion: null },
    pt: { nombre: "Castelos Cátaros – Languedoque", descripcion: null },
    gl: { nombre: "Castelos Cátaros – Languedoc", descripcion: null },
    eu: { nombre: "Katarren Gazteluak – Langedoc", descripcion: null },
  },
  37: {
    it: { nombre: "Castelli di Castiglia – Frontiera e Difesa", descripcion: null },
    pt: { nombre: "Castelos de Castela – Fronteira e Defesa", descripcion: null },
    gl: { nombre: "Castelos de Castela – Fronteira e Defensa", descripcion: null },
    eu: { nombre: "Gaztelako Gazteluak – Muga eta Defentsa", descripcion: null },
  },
  38: {
    it: { nombre: "Itinerario Templare – Spagna e Portogallo", descripcion: null },
    pt: { nombre: "Rota Templária – Espanha e Portugal", descripcion: null },
    gl: { nombre: "Ruta Templaria – España e Portugal", descripcion: null },
    eu: { nombre: "Tenplarioen Ibilbidea – Espainia eta Portugal", descripcion: null },
  },
  39: {
    it: { nombre: "Itinerario Nasride – Eredità di al-Andalus", descripcion: null },
    pt: { nombre: "Rota Nasrida – Legado Andaluz", descripcion: null },
    gl: { nombre: "Ruta Nazarí – Legado Andalusí", descripcion: null },
    eu: { nombre: "Nasriden Ibilbidea – Al-Andalusko Ondarea", descripcion: null },
  },
  40: {
    it: { nombre: "Regni di Taifa – Palazzi e Alcazabe", descripcion: null },
    pt: { nombre: "Reinos Taifa – Palácios e Alcáçovas", descripcion: null },
    gl: { nombre: "Reinos Taifa – Pazos e Alcazabas", descripcion: null },
    eu: { nombre: "Taifa Erresumak – Jauregiak eta Alkazabak", descripcion: null },
  },
  41: {
    it: { nombre: "Preromanico Asturiano – UNESCO", descripcion: null },
    pt: { nombre: "Pré-Românico Asturiano – UNESCO", descripcion: null },
    gl: { nombre: "Prerrománico Asturiano – UNESCO", descripcion: null },
    eu: { nombre: "Asturiar Aurre-erromanikoa – UNESCO", descripcion: null },
  },
  42: {
    it: { nombre: "Itinerario Mozarabico – Toledo e El Bierzo", descripcion: null },
    pt: { nombre: "Rota Moçárabe – Toledo e El Bierzo", descripcion: null },
    gl: { nombre: "Ruta Mozárabe – Toledo e O Bierzo", descripcion: null },
    eu: { nombre: "Mozarabiar Ibilbidea – Toledo eta El Bierzo", descripcion: null },
  },
  43: {
    it: { nombre: "Vía de la Plata – Patrimonio Romano", descripcion: null },
    pt: { nombre: "Vía de la Plata – Património Romano", descripcion: null },
    gl: { nombre: "Vía da Prata – Patrimonio Romano", descripcion: null },
    eu: { nombre: "Zilarraren Bidea – Erromatar Ondarea", descripcion: null },
  },
  44: {
    it: { nombre: "Itinerario Megalitico dell'Alentejo", descripcion: null },
    pt: { nombre: "Rota Megalítica do Alentejo", descripcion: null },
    gl: { nombre: "Ruta Megalítica do Alentejo", descripcion: null },
    eu: { nombre: "Alentejoko Ibilbide Megalitikoa", descripcion: null },
  },
  45: {
    it: { nombre: "Dolmen di Antequera – UNESCO", descripcion: null },
    pt: { nombre: "Dólmens de Antequera – UNESCO", descripcion: null },
    gl: { nombre: "Dólmenes de Antequera – UNESCO", descripcion: null },
    eu: { nombre: "Antequerako Trikuharriak – UNESCO", descripcion: null },
  },
  46: {
    it: { nombre: "Arte Rupestre Preistorica – Nucleo Cantabrico", descripcion: "Zona con la maggior densità di arte paleolitica del mondo, grotte dichiarate Patrimonio UNESCO" },
    pt: { nombre: "Arte Rupestre Pré-histórica – Núcleo Cantábrico", descripcion: "Zona com a maior densidade de arte paleolítica do mundo, grutas declaradas Património UNESCO" },
    gl: { nombre: "Arte Rupestre Prehistórica – Núcleo Cantábrico", descripcion: "Zona coa maior densidade de arte paleolítica do mundo, covas declaradas Patrimonio UNESCO" },
    eu: { nombre: "Historiaurreko Labar Artea – Kantauriar Gunea", descripcion: "Munduko Paleolitoko arte dentsitate handieneko gunea, UNESCO Ondaretzat aitortutako kobazuloak" },
  },
  47: {
    it: { nombre: "Fortificazioni di Vauban – UNESCO", descripcion: null },
    pt: { nombre: "Fortificações de Vauban – UNESCO", descripcion: null },
    gl: { nombre: "Fortificacións de Vauban – UNESCO", descripcion: null },
    eu: { nombre: "Vaubanen Gotorlekuak – UNESCO", descripcion: null },
  },
  48: {
    it: { nombre: "Castelli di Frontiera – Catalogna", descripcion: null },
    pt: { nombre: "Castelos de Fronteira – Catalunha", descripcion: null },
    gl: { nombre: "Castelos de Fronteira – Cataluña", descripcion: null },
    eu: { nombre: "Mugako Gazteluak – Katalunia", descripcion: null },
  },
  49: {
    it: { nombre: "Cammino Francese – Via Jacopea Principale", descripcion: null },
    pt: { nombre: "Caminho Francês – Rota Jacobeia Principal", descripcion: null },
    gl: { nombre: "Camiño Francés – Ruta Xacobea Principal", descripcion: null },
    eu: { nombre: "Bide Frantsesa – Donejakue Bide Nagusia", descripcion: null },
  },
  50: {
    it: { nombre: "Cammino Primitivo – La Prima Via Jacopea", descripcion: null },
    pt: { nombre: "Caminho Primitivo – A Primeira Rota Jacobeia", descripcion: null },
    gl: { nombre: "Camiño Primitivo – A Primeira Ruta Xacobea", descripcion: null },
    eu: { nombre: "Bide Primitiboa – Lehen Donejakue Bidea", descripcion: null },
  },
  51: {
    it: { nombre: "Cammino Portoghese – Lisbona/Porto a Santiago", descripcion: null },
    pt: { nombre: "Caminho Português – Lisboa/Porto a Santiago", descripcion: null },
    gl: { nombre: "Camiño Portugués – Lisboa/Porto a Santiago", descripcion: null },
    eu: { nombre: "Bide Portugesa – Lisboa/Porto Santiagora", descripcion: null },
  },
  52: {
    it: { nombre: "Modernismo Catalano – Gaudí e Domènech", descripcion: null },
    pt: { nombre: "Modernismo Catalão – Gaudí e Domènech", descripcion: null },
    gl: { nombre: "Modernismo Catalán – Gaudí e Domènech", descripcion: null },
    eu: { nombre: "Kataluniako Modernismoa – Gaudí eta Domènech", descripcion: null },
  },
  54: {
    it: { nombre: "Ceramica di Toledo – Patrimonio UNESCO", descripcion: null },
    pt: { nombre: "Cerâmica de Toledo – Património UNESCO", descripcion: null },
    gl: { nombre: "Cerámica de Toledo – Patrimonio UNESCO", descripcion: null },
    eu: { nombre: "Toledoko Zeramika – UNESCO Ondarea", descripcion: null },
  },
  55: {
    it: { nombre: "Cammino del Cid – Itinerario dell'Esilio", descripcion: "Itinerario letterario e storico che segue il percorso del Cantar de mio Cid, da Vivar del Cid (Burgos) a Valencia ed Elche" },
    pt: { nombre: "Caminho do Cid – Rota do Desterro", descripcion: "Rota literária e histórica seguindo o percurso do Cantar de mio Cid, desde Vivar del Cid (Burgos) até Valência e Elche" },
    gl: { nombre: "Camiño do Cid – Ruta do Desterro", descripcion: "Ruta literaria e histórica seguindo o percorrido do Cantar de mio Cid, desde Vivar del Cid (Burgos) ata Valencia e Elche" },
    eu: { nombre: "Cid-en Bidea – Erbestearen Ibilbidea", descripcion: "Cantar de mio Cid-en ibilbideari jarraitzen dion ibilbide literario eta historikoa, Vivar del Cid (Burgos) hiritik Valentzia eta Elcheraino" },
  },
  56: {
    it: { nombre: "Itinerario del Califfato – Da Cordova a Granada", descripcion: "Itinerario storico che collega le due capitali andaluse: la Cordova omayyade e la Granada nasride, attraversando la campagna e la Subbética" },
    pt: { nombre: "Rota do Califado – De Córdoba a Granada", descripcion: "Rota histórica que liga as duas capitais andaluzas: a Córdoba omíada e a Granada nasrida, atravessando o campo e a Subbética" },
    gl: { nombre: "Ruta do Califato – De Córdoba a Granada", descripcion: "Ruta histórica que conecta as dúas capitais andalusís: a Córdoba omeia e a Granada nazarí, atravesando a campiña e a Subbética" },
    eu: { nombre: "Kalifaduriaren Ibilbidea – Kordobatik Granadara", descripcion: "Andaluziako bi hiriburuak lotzen dituen ibilbide historikoa: Kordoba omeiatarra eta Granada nasriarra, landazabala eta Subbética zeharkatuz" },
  },
  57: {
    it: { nombre: "Itinerario dei Pueblos Blancos – Sierra di Cadice", descripcion: "Percorso tra i pueblos blancos della Sierra di Grazalema e della Serranía de Ronda, da Arcos de la Frontera a Ronda" },
    pt: { nombre: "Rota dos Pueblos Blancos – Serra de Cádis", descripcion: "Percurso pelos pueblos brancos da Serra de Grazalema e Serranía de Ronda, desde Arcos de la Frontera até Ronda" },
    gl: { nombre: "Ruta dos Pueblos Brancos – Serra de Cádiz", descripcion: "Percorrido polos pobos brancos da Serra de Grazalema e Serranía de Ronda, desde Arcos de la Frontera ata Ronda" },
    eu: { nombre: "Herri Zurien Ibilbidea – Cadizko Mendilerroa", descripcion: "Grazalema eta Rondako mendilerroetako herri zurietan zeharreko ibilbidea, Arcos de la Frontera-tik Rondaraino" },
  },
  58: {
    it: { nombre: "Itinerario di Carlo V – Dal Cantabrico a Yuste", descripcion: "Ultimo viaggio dell'imperatore Carlo V dal suo sbarco a Laredo fino al suo ritiro nel Monastero di Yuste" },
    pt: { nombre: "Rota de Carlos V – Do Cantábrico a Yuste", descripcion: "Última viagem do imperador Carlos V desde o seu desembarque em Laredo até ao seu retiro no Mosteiro de Yuste" },
    gl: { nombre: "Ruta de Carlos V – Do Cantábrico a Yuste", descripcion: "Última viaxe do emperador Carlos V desde o seu desembarco en Laredo ata o seu retiro no Mosteiro de Yuste" },
    eu: { nombre: "Karlos V.aren Ibilbidea – Kantauriarretik Yusteraino", descripcion: "Karlos V.a enperadorearen azken bidaia, Laredon lehorreratu zenetik Yusteko Monasterioan erretiratu zen arte" },
  },
  59: {
    it: { nombre: "Via Francigena – Da Canterbury a Roma", descripcion: "Grande rotta di pellegrinaggio medievale da Canterbury a Roma, attraversando Francia, Svizzera e Italia" },
    pt: { nombre: "Via Francigena – De Canterbury a Roma", descripcion: "Grande rota de peregrinação medieval desde Canterbury até Roma, atravessando França, Suíça e Itália" },
    gl: { nombre: "Via Francigena – De Canterbury a Roma", descripcion: "Grande ruta de peregrinación medieval desde Canterbury ata Roma, atravesando Francia, Suíza e Italia" },
    eu: { nombre: "Via Francigena – Canterburytik Erromara", descripcion: "Erdi Aroko erromesaldi-ibilbide handia, Canterburytik Erromaraino, Frantzia, Suitza eta Italia zeharkatuz" },
  },
  60: {
    it: { nombre: "TransRomanica – Itinerario Europeo del Romanico", descripcion: "Itinerario culturale del Consiglio d'Europa che collega i principali monumenti romanici di 7 paesi europei" },
    pt: { nombre: "TransRomanica – Rota Europeia do Românico", descripcion: "Itinerário cultural do Conselho da Europa que liga os principais monumentos românicos de 7 países europeus" },
    gl: { nombre: "TransRomanica – Ruta Europea do Románico", descripcion: "Itinerario cultural do Consello de Europa que conecta os principais monumentos románicos de 7 países europeos" },
    eu: { nombre: "TransRomanica – Erromanikoaren Europako Ibilbidea", descripcion: "Europako Kontseiluaren ibilbide kulturala, 7 herrialde europarretako erromaniko monumentu nagusiak lotzen dituena" },
  },
  61: {
    it: { nombre: "Itinerario dei Fenici – Dal Libano a Ibiza", descripcion: "Itinerario culturale del Consiglio d'Europa seguendo le rotte commerciali fenicie nel Mediterraneo" },
    pt: { nombre: "Rota dos Fenícios – Do Líbano a Ibiza", descripcion: "Itinerário cultural do Conselho da Europa seguindo as rotas comerciais fenícias pelo Mediterrâneo" },
    gl: { nombre: "Ruta dos Fenicios – Do Líbano a Ibiza", descripcion: "Itinerario cultural do Consello de Europa seguindo as rutas comerciais fenicias polo Mediterráneo" },
    eu: { nombre: "Feniziarren Ibilbidea – Libanotik Ibizara", descripcion: "Europako Kontseiluaren ibilbide kulturala, Mediterraneoko feniziar merkataritza-ibilbideei jarraituz" },
  },
  63: {
    it: { nombre: "Arte Rupestre Preistorica – Sud-ovest della Francia (Dordogna)", descripcion: "Le grotte dipinte più famose di Francia, con capolavori del paleolitico superiore" },
    pt: { nombre: "Arte Rupestre Pré-histórica – Sudoeste de França (Dordonha)", descripcion: "As grutas pintadas mais famosas de França, com obras-primas do paleolítico superior" },
    gl: { nombre: "Arte Rupestre Prehistórica – Sueste de Francia (Dordoña)", descripcion: "As covas pintadas máis famosas de Francia, con obras mestras do paleolítico superior" },
    eu: { nombre: "Historiaurreko Labar Artea – Frantzia Hego-mendebaldea (Dordoña)", descripcion: "Frantziako kobazulo margotu ospetsuenak, Goi Paleolitoko maisulanekin" },
  },
  64: {
    it: { nombre: "Arte Rupestre Preistorica – Incisioni all'Aperto", descripcion: "I più grandi insiemi di incisioni paleolitiche all'aperto della penisola iberica" },
    pt: { nombre: "Arte Rupestre Pré-histórica – Gravuras ao Ar Livre", descripcion: "Os maiores conjuntos de gravuras paleolíticas ao ar livre da Península Ibérica" },
    gl: { nombre: "Arte Rupestre Prehistórica – Gravados ao Aire Libre", descripcion: "Os maiores conxuntos de gravados paleolíticos ao aire libre da península ibérica" },
    eu: { nombre: "Historiaurreko Labar Artea – Aire Zabaleko Grabatuak", descripcion: "Iberiar penintsulako Paleolitoko aire zabaleko grabatu multzo handienak" },
  },
  65: {
    it: { nombre: "Arte Rupestre Preistorica – Arco Mediterraneo (Levantino)", descripcion: "Scene di caccia e raccolta con figure umane stilizzate, patrimonio UNESCO" },
    pt: { nombre: "Arte Rupestre Pré-histórica – Arco Mediterrânico (Levantino)", descripcion: "Cenas de caça e recolecção com figuras humanas estilizadas, património UNESCO" },
    gl: { nombre: "Arte Rupestre Prehistórica – Arco Mediterráneo (Levantino)", descripcion: "Escenas de caza e recolección con figuras humanas estilizadas, patrimonio UNESCO" },
    eu: { nombre: "Historiaurreko Labar Artea – Mediterraneoko Arkua (Levantearra)", descripcion: "Ehiza eta bilketa eszenak giza irudi estilizatuekin, UNESCO ondarea" },
  },
  66: {
    it: { nombre: "Itinerario Europeo dei Cimiteri – Spagna", descripcion: "Gioielli del modernismo e neoclassicismo funerario nei cimiteri spagnoli" },
    pt: { nombre: "Rota Europeia dos Cemitérios – Espanha", descripcion: "Joias do modernismo e neoclassicismo funerário nos cemitérios espanhóis" },
    gl: { nombre: "Ruta Europea dos Cemiterios – España", descripcion: "Xoias do modernismo e neoclasicismo funerario nos cemiterios españois" },
    eu: { nombre: "Hilerrien Europako Ibilbidea – Espainia", descripcion: "Espainiako hilerrietako hileta-modernismo eta -neoklasizismoaren bitxiak" },
  },
  67: {
    it: { nombre: "Itinerario Europeo dei Cimiteri – Grandi Necropoli", descripcion: "I cimiteri monumentali più emblematici d'Europa, musei all'aperto di scultura e architettura" },
    pt: { nombre: "Rota Europeia dos Cemitérios – Grandes Necrópoles", descripcion: "Os cemitérios monumentais mais emblemáticos da Europa, museus ao ar livre de escultura e arquitectura" },
    gl: { nombre: "Ruta Europea dos Cemiterios – Grandes Necrópoles", descripcion: "Os cemiterios monumentais máis emblemáticos de Europa, museos ao aire libre de escultura e arquitectura" },
    eu: { nombre: "Hilerrien Europako Ibilbidea – Nekropoli Handiak", descripcion: "Europako hilerri monumental enblematikoenak, eskultura eta arkitekturaren aire zabaleko museoak" },
  },
  68: {
    it: { nombre: "Vallo di Adriano – Frontiera dell'Impero Romano", descripcion: "La linea difensiva romana più importante del nord Europa, 117 km da costa a costa" },
    pt: { nombre: "Muralha de Adriano – Fronteira do Império Romano", descripcion: "A linha defensiva romana mais importante do norte da Europa, 117 km de costa a costa" },
    gl: { nombre: "Muro de Adriano – Fronteira do Imperio Romano", descripcion: "A liña defensiva romana máis importante do norte de Europa, 117 km de costa a costa" },
    eu: { nombre: "Hadrianoren Harresia – Erromatar Inperioaren Muga", descripcion: "Europa iparraldeko erromatar defentsa-lerro garrantzitsuena, 117 km kostatik kostara" },
  },
  69: {
    it: { nombre: "Castelli Catari – Cittadelle delle Vertigini", descripcion: "Fortezze inespugnabili in cima a creste rocciose della Linguadoca, testimoni della crociata albigese" },
    pt: { nombre: "Castelos Cátaros – Cidadelas da Vertigem", descripcion: "Fortalezas inexpugnáveis no topo de cristas rochosas do Languedoque, testemunhas da cruzada albigense" },
    gl: { nombre: "Castelos Cátaros – Cidadelas do Vertixo", descripcion: "Fortalezas inexpugnables no alto de cristas rochosas do Languedoc, testemuñas da cruzada albixense" },
    eu: { nombre: "Katarren Gazteluak – Bertigoaren Hiri Gotortuak", descripcion: "Langedoceko haitzezko gainetan dauden gotorleku menderaezinak, gurutzada albigentsearen lekuko" },
  },
  70: {
    it: { nombre: "La Strada Romantica – Baviera Medievale", descripcion: "Da Würzburg a Füssen, l'essenza della Germania da fiaba" },
    pt: { nombre: "A Rota Romântica – Baviera Medieval", descripcion: "De Würzburg a Füssen, a essência da Alemanha de conto de fadas" },
    gl: { nombre: "A Ruta Romántica – Baviera Medieval", descripcion: "De Würzburg a Füssen, a esencia da Alemaña de conto de fadas" },
    eu: { nombre: "Bide Erromantikoa – Erdi Aroko Bavaria", descripcion: "Würzburgetik Füsseneraino, ipuin-Alemaniaren funtsa" },
  },
  71: {
    it: { nombre: "Monasteri della Bucovina – Affreschi Esterni", descripcion: "Chiese del XV-XVI secolo con facciate interamente affrescate, patrimonio UNESCO della Romania" },
    pt: { nombre: "Mosteiros da Bucovina – Frescos Exteriores", descripcion: "Igrejas dos séc. XV-XVI com fachadas totalmente pintadas a fresco, património UNESCO da Roménia" },
    gl: { nombre: "Mosteiros de Bucovina – Frescos Exteriores", descripcion: "Igrexas do s. XV-XVI con fachadas totalmente pintadas ao fresco, patrimonio UNESCO de Romanía" },
    eu: { nombre: "Bukovinako Monasterioak – Kanpoaldeko Freskoak", descripcion: "XV-XVI mendeetako elizak, fatxadak osoki freskoz margotuak, Errumaniako UNESCO ondarea" },
  },
  72: {
    it: { nombre: "Siti Reali di Spagna – Patrimonio Nazionale", descripcion: "L'asse del potere della monarchia ispanica: palazzi, monasteri e giardini reali" },
    pt: { nombre: "Sítios Reais de Espanha – Património Nacional", descripcion: "O eixo do poder da monarquia hispânica: palácios, mosteiros e jardins reais" },
    gl: { nombre: "Sitios Reais de España – Patrimonio Nacional", descripcion: "O eixo do poder da monarquía hispánica: pazos, mosteiros e xardíns reais" },
    eu: { nombre: "Espainiako Errege Lekuak – Ondare Nazionala", descripcion: "Hispaniar monarkiaren botere ardatza: errege jauregiak, monasterioak eta lorategiak" },
  },
};

(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\s+/g,''), ssl: { rejectUnauthorized: false } });
  let total = 0;
  for (const [id, langs] of Object.entries(T)) {
    for (const [lang, data] of Object.entries(langs)) {
      const res = await p.query(`
        INSERT INTO rutas_culturales_traducciones (ruta_id, lang, nombre, descripcion)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (ruta_id, lang) DO UPDATE SET nombre=EXCLUDED.nombre, descripcion=EXCLUDED.descripcion
      `, [parseInt(id, 10), lang, data.nombre, data.descripcion]);
      total += res.rowCount;
    }
  }
  console.log(`✓ ${total} traducciones aplicadas (${Object.keys(T).length} rutas × 4 idiomas)`);
  await p.end();
})();
