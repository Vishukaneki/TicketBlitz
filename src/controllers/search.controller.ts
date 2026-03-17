// src/controllers/search.controller.ts
import { Request, Response } from 'express';
import { esClient } from '../config/elasticsearch';

export const searchMovies = async (req: Request, res: Response): Promise<void> => {
  try {
    const { q } = req.query; // e.g., ?q=batman

    if (!q || typeof q !== 'string') {
      res.status(400).json({ success: false, message: 'Search query is required' });
      return;
    }

    const result = await esClient.search({
      index: 'movies',
      body: {
        query: {
          multi_match: {
            query: q,
            fields: ['title^3', 'language', 'cities', 'venues'], 
            fuzziness: 2 
          }
        }
      }
    });
    const hits = result.hits.hits.map((hit: any) => hit._source);

    res.status(200).json({
      success: true,
      totalFound: hits.length,
      data: hits
    });

  } catch (error) {
    console.error('Search API Error:', error);
    res.status(500).json({ success: false, message: 'Error searching movies' });
  }
};