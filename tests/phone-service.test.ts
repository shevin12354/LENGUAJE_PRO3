import { describe, it, expect, vi } from 'vitest';
import { PhoneApiService } from '../server';

describe('PhoneApiService (inyección de dependencias)', () => {
  it('Prueba 1: retorna la estructura JSON esperada', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        products: [{ brand: 'Apple', title: 'iPhone 15', price: 999, stock: 12, thumbnail: 'img.jpg' }]
      })
    }));

    const service = new PhoneApiService(mockFetch as any);
    const resultado = await service.obtenerTelefonos('https://dummyjson.com/products', 1);

    expect(resultado.source).toBe('api');
    expect(Array.isArray(resultado.data)).toBe(true);
    expect(resultado.data[0].brand).toBe('Apple');
    expect(resultado.data[0].phone_name).toBe('iPhone 15');
    expect(typeof resultado.data[0].price).toBe('number');
  });

  it('Prueba 2: si la API falla, activa el catálogo de respaldo', async () => {
    const mockFetchError = vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    }));

    const service = new PhoneApiService(mockFetchError as any);
    const resultado = await service.obtenerTelefonos('https://dummyjson.com/products', 3);

    expect(resultado.source).toBe('fallback');
    expect(resultado.data).toHaveLength(3);
    expect(mockFetchError).toHaveBeenCalledTimes(2); // 2 intentos antes de rendirse
  });

  it('Prueba 3: reintenta y se recupera si el primer intento falla', async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout simulado'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          products: [{ brand: 'Samsung', title: 'Galaxy S24', price: 800, stock: 10, thumbnail: 'url' }]
        })
      });

    const service = new PhoneApiService(mockFetch as any);
    const resultado = await service.obtenerTelefonos('https://dummyjson.com/products', 1);

    expect(resultado.source).toBe('api');
    expect(resultado.data[0].brand).toBe('Samsung');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});