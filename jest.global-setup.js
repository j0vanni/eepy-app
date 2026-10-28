// Pin the timezone so date-sensitive engine tests are deterministic (and exercise DST rules).
module.exports = async () => {
  process.env.TZ = 'America/Chicago';
};
