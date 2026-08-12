const axios = require('axios');

const API_URL = 'http://localhost:3334/api/anapath';

const data = [
  {
    patientId: 'P001',
    typeExamen: 'BIOPSIE',
    prelevement: {
      site: 'Foie',
      description: '3 fragments'
    }
  },
  {
    patientId: 'P002',
    typeExamen: 'FCV_PAP',
    prelevement: {
      site: 'Col utérin',
      description: 'Frottis'
    }
  },
  {
    patientId: 'P12345',
    typeExamen: 'BIOPSIE',
    prelevement: {
      site: 'Foie',
      description: 'Biopsie hépatique'
    }
  }
];

async function insertData() {
  console.log('🔄 Insertion des données...');
  
  for (const item of data) {
    try {
      const response = await axios.post(API_URL, item, {
        headers: { 'Content-Type': 'application/json' }
      });
      console.log(`✅ Inserté: ${response.data.anapathId} - ${response.data.patientId}`);
    } catch (error) {
      console.error(`❌ Erreur: ${error.message}`);
    }
  }
  
  console.log('📋 Terminé !');
}

insertData();
