// src/controllers/search.controller.ts
import { Request, Response } from 'express';
import { esClient } from '../config/elasticsearch';

export const searchMovies = async (req: Request, res: Response): Promise<void> => {
  try {
    const { q, page = '1', limit = '10' } = req.query;

    if (!q || typeof q !== 'string') {
      res.status(400).json({ success: false, message: 'Search query is required' });
      return;
    }

    const from = (parseInt(page as string) - 1) * parseInt(limit as string);
    const size = parseInt(limit as string);

    const result = await esClient.search({
      index: 'movies',
      from,
      size,
      query: {
        multi_match: {
          query: q,
          fields: [
            'title^3',    // title gets 3x boost — most important
            'cast',       // search by actor name
            'genre',      // search by genre
            'language',   // search by language
            'cities',     // search by city e.g. "Mumbai"
            'venues',     // search by venue e.g. "PVR"
          ],
          fuzziness: 'AUTO',   // handles typos e.g. "batmn" → "batman"
          operator: 'or',
        },
      },
    });

    // Get actual total count (ES v8 returns an object)
    const total =
      typeof result.hits.total === 'object'
        ? result.hits.total.value
        : result.hits.total ?? 0;

    const hits = result.hits.hits.map((hit: any) => hit._source);

    res.status(200).json({
      success: true,
      totalFound: total,
      page: parseInt(page as string),
      limit: size,
      data: hits,
    });

  } catch (error: any) {
    // Give a clearer error message if index doesn't exist
    if (error?.meta?.body?.error?.type === 'index_not_found_exception') {
      res.status(503).json({
        success: false,
        message: 'Search index not ready. Run: npx tsx src/sync.ts',
      });
      return;
    }
    console.error('Search API Error:', error);
    res.status(500).json({ success: false, message: 'Error searching movies' });
  }
};