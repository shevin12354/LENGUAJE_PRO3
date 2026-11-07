/**
 * Script: db-view.js
 * Permite visualizar el estado, tablas, columnas y registros de celulares.sqlite
 * Ejecución: node db-view.js (o: npm run db:view)
 */

const { Sequelize, QueryTypes } = require('sequelize');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.resolve(__dirname, 'celulares.sqlite');

async function main() {
  console.log('\n============================================================');
  console.log('🔍 INSPECTOR DE BASE DE DATOS SQLITE (Uniremington - LP3)');
  console.log(`📁 Archivo objetivo: ${DB_PATH}`);
  console.log('============================================================\n');

  if (!fs.existsSync(DB_PATH)) {
    console.warn('⚠️  ADVERTENCIA: El archivo "celulares.sqlite" no existe aún.');
    console.log('👉 Ejecuta primero "npm start" para que el servidor cree la base de datos.');
    process.exit(0);
  }

  const stats = fs.statSync(DB_PATH);
  console.log(`✓ Archivo encontrado: ${(stats.size / 1024).toFixed(2)} KB (${stats.size} bytes)`);

  const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: DB_PATH,
    logging: false
  });

  try {
    await sequelize.authenticate();
    console.log('✓ Conexión establecida con Sequelize ORM.');

    // Consulta con QueryTypes.SELECT
    const tablesInfo = await sequelize.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      { type: QueryTypes.SELECT }
    );

    const tableNames = tablesInfo.map(t => t.name);

    if (tableNames.length === 0) {
      console.log('\n⚠️  No hay tablas de usuario en la base de datos.');
      await sequelize.close();
      return;
    }

    console.log(`\n📋 Tablas encontradas (${tableNames.length}):`, tableNames.join(', '));
    console.log('------------------------------------------------------------');

    const dbView = {};

    for (const table of tableNames) {
      const columns = await sequelize.query(`PRAGMA table_info("${table}")`, {
        type: QueryTypes.SELECT
      });

      const rows = await sequelize.query(`SELECT * FROM "${table}"`, {
        type: QueryTypes.SELECT
      });

      dbView[table] = {
        totalRegistros: rows.length,
        columnas: columns.map(col => ({
          campo: col.name,
          tipo: col.type,
          clavePrimaria: Boolean(col.pk),
          noNulo: Boolean(col.notnull)
        })),
        registros: rows
      };

      console.log(`\n🔹 Tabla: "${table}" | Total filas: ${rows.length}`);
      console.log('   Columnas:', columns.map(c => `${c.name} (${c.type})`).join(', '));
      if (rows.length > 0) {
        console.log('   Muestra primer registro:', JSON.stringify(rows[0]));
      }
    }

    console.log('\n============================================================');
    console.log('📦 JSON COMPLETO DE LA BASE DE DATOS:');
    console.log('============================================================');
    console.log(JSON.stringify({ database: 'celulares.sqlite', tables: dbView }, null, 2));

    await sequelize.close();
    console.log('\n✓ Conexión cerrada limpiamente.');
  } catch (error) {
    console.error('\n❌ Error al inspeccionar la base de datos:', error.message);
    if (sequelize) {
      try { await sequelize.close(); } catch {}
    }
    process.exit(1);
  }
}

main();