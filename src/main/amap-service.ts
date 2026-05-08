/**
 * 高德地图 REST API 服务
 * 使用 Web服务 Key 从 main process 调用，用于地理编码和周边酒店搜索
 */

import https from 'https';

const AMAP_KEY = '9af9711ffb21c6f8bfcedf8345546655';
const AMAP_BASE = 'https://restapi.amap.com/v3';

interface AmapGeoResult {
  location: string;   // "116.397428,39.90923"
  formatted_address: string;
  province: string;
  city: string;
}

export interface ResolvedLocation {
  lat: number;
  lng: number;
  address: string;
  amapPoiId?: string;
}

export interface NearbyHotel {
  name: string;
  amapPoiId: string;
  address: string;
  lat: number;
  lng: number;
  distance: number;    // 米
  type: string;        // 高德分类，如 "住宿服务;宾馆酒店;星级酒店"
  tel?: string;
}

function request(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${data.substring(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * 地理编码：酒店名/地址 → 经纬度
 */
export async function geocode(address: string, city?: string): Promise<ResolvedLocation | null> {
  const params = new URLSearchParams({
    key: AMAP_KEY,
    address,
    output: 'JSON',
  });
  if (city) params.set('city', city);

  const result = await request(`${AMAP_BASE}/geocode/geo?${params}`);

  if (result.status !== '1' || !result.geocodes?.length) {
    return null;
  }

  const geo: AmapGeoResult = result.geocodes[0];
  const [lng, lat] = geo.location.split(',').map(Number);

  return {
    lat,
    lng,
    address: geo.formatted_address,
  };
}

/**
 * POI 搜索：用关键词+位置搜索（优先用这个，比纯地理编码更适合搜酒店）
 */
export async function poiSearch(keyword: string, city?: string): Promise<ResolvedLocation | null> {
  const params = new URLSearchParams({
    key: AMAP_KEY,
    keywords: keyword,
    types: '100000',  // 住宿服务大类
    output: 'JSON',
    offset: '1',
    page: '1',
  });
  if (city) params.set('city', city);

  const result = await request(`${AMAP_BASE}/place/text?${params}`);

  if (result.status !== '1' || !result.pois?.length) {
    // fallback 到地理编码
    return geocode(keyword, city);
  }

  const poi = result.pois[0];
  const [lng, lat] = poi.location.split(',').map(Number);

  return {
    lat,
    lng,
    address: poi.address || poi.cityname + poi.adname,
    amapPoiId: poi.id,
  };
}

/**
 * 关键词搜索酒店：按名称搜索，返回多条结果供用户选择添加为竞品
 */
export async function searchHotelByName(keyword: string): Promise<NearbyHotel[]> {
  const params = new URLSearchParams({
    key: AMAP_KEY,
    keywords: keyword,
    types: '100100',  // 宾馆酒店（排除招待所、民宿等）
    output: 'JSON',
    offset: '10',
    page: '1',
    children: '1',
    extensions: 'all',
  });

  const result = await request(`${AMAP_BASE}/place/text?${params}`);

  if (result.status !== '1' || !result.pois?.length) {
    return [];
  }

  return result.pois.map((poi: any) => {
    const [lng, lat] = poi.location.split(',').map(Number);
    return {
      name: poi.name || '',
      amapPoiId: poi.id,
      address: poi.address || poi.cityname + poi.adname || '',
      lat,
      lng,
      distance: 0,
      type: poi.type || '',
      tel: poi.tel || undefined,
    };
  });
}

/**
 * 周边搜索：找指定坐标附近的酒店
 */
export async function searchNearbyHotels(
  lat: number,
  lng: number,
  radius: number = 3000,  // 默认3km
): Promise<NearbyHotel[]> {
  const allResults: NearbyHotel[] = [];
  const seenIds = new Set<string>();
  const pageSize = 25;

  // 用宾馆酒店子类搜索（100100），排除旅馆招待所(100200)等非正规酒店
  const hotelTypes = '100100';

  // 分段搜索：将大半径拆成多个小半径段，绕过高德单次搜索的数量限制
  // 例如 5000m → [1000, 2000, 3500, 5000]
  const segments: number[] = [];
  if (radius <= 1000) {
    segments.push(radius);
  } else if (radius <= 2000) {
    segments.push(1000, radius);
  } else if (radius <= 3000) {
    segments.push(1000, 2000, radius);
  } else {
    segments.push(1000, 2000, 3500, radius);
  }

  for (const segRadius of segments) {
    let page = 1;
    while (true) {
      const params = new URLSearchParams({
        key: AMAP_KEY,
        location: `${lng},${lat}`,
        types: hotelTypes,
        radius: segRadius.toString(),
        sortrule: 'distance',
        output: 'JSON',
        offset: pageSize.toString(),
        page: page.toString(),
        children: '1',
        extensions: 'all',
      });

      const result = await request(`${AMAP_BASE}/place/around?${params}`);
      if (result.status !== '1' || !result.pois?.length) break;

      for (const poi of result.pois) {
        // 去重（不同半径段可能返回重复结果）
        if (seenIds.has(poi.id)) continue;
        seenIds.add(poi.id);

        const name = poi.name || '';

        const [poiLng, poiLat] = poi.location.split(',').map(Number);
        allResults.push({
          name,
          amapPoiId: poi.id,
          address: poi.address || '',
          lat: poiLat,
          lng: poiLng,
          distance: parseInt(poi.distance) || 0,
          type: poi.type || '',
          tel: poi.tel || undefined,
        });
      }

      if (result.pois.length < pageSize) break;
      page++;
    }
  }

  // 按距离排序
  allResults.sort((a, b) => a.distance - b.distance);
  return allResults;
}
