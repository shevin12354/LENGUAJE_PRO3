import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { app, asegurarConexion, sembrarUsuariosIniciales, getModels } from '../server';

let token = '';
const idsCreados: number[] = [];
const telefono = {
  brand: 'TestBrand',
  phone_name: 'Test Phone X1',
  image: 'https://example.com/x.jpg',
  price: 123.45,
  stock: 7
};

beforeAll(async () => {
  // La notificación a httpbin no debe salir a internet durante las pruebas
  vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: async () => ({ ok: true }) })));

  await asegurarConexion();
  await sembrarUsuariosIniciales();

  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: 'admin', password: process.env.SEED_PASSWORD || '123' });
  token = res.body.token;
});

afterAll(async () => {
  const { PhoneModel, sequelize } = getModels();
  if (idsCreados.length) await PhoneModel.destroy({ where: { id: idsCreados } });
  await sequelize!.close();
});

describe('Pruebas de integración', () => {
  it('1. Create: POST devuelve 201 y el dato existe en la BD', async () => {
    const res = await request(app)
      .post('/api/phones')
      .set('Authorization', `Bearer ${token}`)
      .send(telefono);

    expect(res.status).toBe(201);
    idsCreados.push(res.body.data.id);

    const { PhoneModel } = getModels();
    const enBd = await PhoneModel.findByPk(res.body.data.id);
    expect(enBd).not.toBeNull();
    expect(enBd.phone_name).toBe(telefono.phone_name);
  });

  it('2. Read: GET /:id devuelve exactamente el dato guardado en BD', async () => {
    const { PhoneModel } = getModels();
    const guardado = await PhoneModel.create({ ...telefono, phone_name: 'Test Phone Read' });
    idsCreados.push(guardado.id);

    const res = await request(app).get(`/api/phones/${guardado.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: guardado.id,
      brand: 'TestBrand',
      phone_name: 'Test Phone Read',
      price: 123.45,
      stock: 7
    });
  });

  it('3. Delete: tras DELETE, GET del mismo ID devuelve 404', async () => {
    const creado = await request(app)
      .post('/api/phones')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...telefono, phone_name: 'Test Phone Delete' });
    const id = creado.body.data.id;

    const del = await request(app).delete(`/api/phones/${id}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    const despues = await request(app).get(`/api/phones/${id}`);
    expect(despues.status).toBe(404);
  });

  // Extras (no los pide el reto, pero prueban Parte 1 y Parte 2)
  it('Extra seguridad: el header x-user-role falsificado ya no da acceso', async () => {
    const res = await request(app).delete('/api/phones/1').set('x-user-role', 'admin');
    expect(res.status).toBe(401);
  });

  it('Extra observabilidad: GET /health responde ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});