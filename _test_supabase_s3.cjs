/**
 * Test rápido de conectividad con Supabase Storage vía S3 API.
 * Sube un archivo de prueba y verifica que la URL pública funciona.
 */
require('dotenv').config();
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const https = require('https');

const s3 = new S3Client({
    endpoint: process.env.SUPABASE_S3_ENDPOINT,
    region: process.env.SUPABASE_S3_REGION,
    credentials: {
        accessKeyId: process.env.SUPABASE_S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.SUPABASE_S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
});

const BUCKET = process.env.SUPABASE_BUCKET;
const KEY = '_test/hello.txt';
const CONTENT = `Hola desde patrimonio. ${new Date().toISOString()}`;

function publicUrl(key) {
    return `${process.env.SUPABASE_PROJECT_URL}/storage/v1/object/public/${BUCKET}/${key}`;
}

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body }));
        }).on('error', reject);
    });
}

(async () => {
    console.log('1. Subiendo archivo de prueba a bucket "' + BUCKET + '"...');
    await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: KEY,
        Body: CONTENT,
        ContentType: 'text/plain',
    }));
    console.log('   OK upload');

    console.log('2. Listando objetos en _test/...');
    const list = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: '_test/' }));
    console.log('   ' + (list.Contents || []).map(o => o.Key).join(', '));

    const url = publicUrl(KEY);
    console.log('3. Verificando URL pública: ' + url);
    const res = await fetchUrl(url);
    console.log('   HTTP ' + res.status);
    if (res.status === 200) {
        console.log('   Body: ' + res.body);
        console.log('\n✅ TODO OK — Supabase Storage funciona y el bucket es público.');
    } else {
        console.log('   ⚠️  El bucket no parece público. Verifica el toggle "Public bucket".');
    }

    console.log('\n4. Limpiando archivo de prueba...');
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: KEY }));
    console.log('   OK delete');
})().catch(e => {
    console.error('\n❌ ERROR:', e.message);
    if (e.Code) console.error('   Code:', e.Code);
    if (e.$metadata) console.error('   HTTP:', e.$metadata.httpStatusCode);
    process.exit(1);
});
