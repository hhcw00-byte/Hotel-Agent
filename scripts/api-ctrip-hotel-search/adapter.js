function adapt(rawData) {
  if (!rawData || !rawData.searchResults) return { platform: 'ctrip', data: [] };
  
  const hotels = rawData.searchResults
    .filter(item => item.type === 'Hotel')
    .map(item => ({
      hotelId: String(item.id),
      name: item.word,
      cityName: item.cityName,
      cityId: item.cityId,
      displayName: item.displayName
    }));

  return { platform: 'ctrip', data: hotels };
}

module.exports = { adapt };
