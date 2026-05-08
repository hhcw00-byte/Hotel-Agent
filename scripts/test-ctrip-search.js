import axios from 'axios';

/**
 * 携程酒店搜索建议 API (gaHotelSearchEngine)
 * 作用：根据关键词搜索酒店，返回 hotelId 和名称
 * 来源：已验证的 API 记录 (soa2/21881)
 */
export async function searchHotel(params) {
  const { keyword } = params;
  if (!keyword) throw new Error('keyword is required');

  const url = 'https://m.ctrip.com/restapi/soa2/21881/json/gaHotelSearchEngine';
  
  const data = {
    "keyword": keyword,
    "cityId": 1,
    "searchType": "K",
    "platform": "online",
    "pageID": "102001",
    "head": {
      "cid": "09031015110542340001",
      "ctok": "",
      "cver": "1.0",
      "lang": "01",
      "sid": "8888",
      "syscode": "09",
      "auth": null,
      "extension": [
        {"name": "protocal", "value": "https"}
      ]
    }
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'origin': 'https://hotels.ctrip.com',
        'referer': 'https://hotels.ctrip.com/',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Ctrip Search API Error:', error.response?.data || error.message);
    throw error;
  }
}

// 自动执行测试（如果作为脚本运行）
if (process.env.NODE_TEST === 'true') {
  searchHotel({ keyword: '北京三里屯太古里桔子水晶酒店' })
    .then(res => console.log(JSON.stringify(res, null, 2)))
    .catch(err => console.error(err));
}
