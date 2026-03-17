// src/config/elasticsearch.ts
import { Client } from '@elastic/elasticsearch';
import dotenv from 'dotenv';

dotenv.config();

const esNode = process.env.ELASTICSEARCH_NODE || 'http://localhost:9200';

// Initialize the Elasticsearch Client
export const esClient = new Client({
  node: esNode,
  // Agar production me security on hoti, toh yahan auth: { username, password } lagta
});

// A simple function to check if ES is alive when our server starts
export const checkElasticsearchConnection = async () => {
  try {
    const health = await esClient.cluster.health({});
    console.log(` Elasticsearch Connected! Cluster Status: ${health.status}`);
  } catch (error) {
    console.error(' Elasticsearch Connection Failed:', error);
  }
};