// node standard library
const https = require('https');
// const { URL } = require('url');
const url = require('url'); // Google Cloud Function Node.js is v6
const crypto = require('crypto');

// thirdparty packages
const FormData = require('form-data');
const OAuth = require('oauth-1.0a');

const config = require('./config.json');

const TWITTER_STATUS_SHOW_URL = 'https://api.twitter.com/1.1/statuses/show.json';
const GYAZO_UPLOAD_URL = 'https://upload.gyazo.com/api/upload';

const oauth = OAuth({
  consumer: {
    key: config.TWITTER_KEY,
    secret: config.TWITTER_SECRET,
  },
  signature_method: 'HMAC-SHA1',
  hash_function: (baseStr, key) =>
    crypto.createHmac('sha1', key).update(baseStr).digest('base64'),
});

const token = {
  key: config.TWITTER_TOKEN,
  secret: config.TWITTER_TOKEN_SECRET,
};

function getStatus(statusId, cb) {
  // const url = new URL(`${TWITTER_STATUS_SHOW_URL}?id=${statusId}`);
  const reqUrl = url.parse(`${TWITTER_STATUS_SHOW_URL}?id=${statusId}`);
  const requestData = { url: reqUrl.href, method: 'GET' };
  const options = {
    protocol: reqUrl.protocol,
    host: reqUrl.host,
    path: reqUrl.pathname + reqUrl.search,
    headers: oauth.toHeader(oauth.authorize(requestData, token)),
  };

  https.get(options, (res) => {
    if (res.statusCode !== 200) {
      console.error(`status ${res.statusCode} from twittter`);
      return;
    }

    res.setEncoding('utf8');
    let rawData = '';
    res.on('data', (chunk) => { rawData += chunk; });
    res.on('end', () => {
      let data;
      try {
        data = JSON.parse(rawData);
      } catch (e) {
        console.error(`JSON parse fail msg: ${e.message}`);
        return;
      }

      if (data.extended_entities === undefined
          || data.extended_entities.media === undefined) {
        return;
      }

      const text = data.text;
      // make sure to use https urls
      const medias = data.extended_entities.media
        .filter(obj => obj.type === 'photo')
        .map(obj => [obj.expanded_url, obj.media_url_https]);

      console.log(`text: ${text}`);
      console.log(`found ${medias.length} medias`);

      cb(text, medias);
    });
  }).on('error', (e) => {
    console.error(`twitter connection error msg: ${e.message}`);
  });
}

function uploadToGyazo(img, refererUrl, title, desc, cb) {
  const form = new FormData();
  form.append('access_token', config.GYAZO_TOKEN);
  form.append('imagedata', img);
  form.append('referer_url', refererUrl);
  form.append('title', title);
  form.append('desc', desc);

  form.submit(GYAZO_UPLOAD_URL, (err, res) => {
    if (err) {
      console.error(`uploading gyazo failed msg: ${err.message}`);
      return;
    }
    if (res.statusCode !== 200) {
      console.error(`status ${res.statusCode} from gyazo`);
      return;
    }
    console.log('uploaded to gyazo');
    cb();
  });
}

/**
 * Get tweet and upload image to Gyazo.
 *
 * @example
 * curl -X POST "https://us-central1-YOUR-PROJECT-ID.cloudfunctions.net/twitterFavGyazo" -H "Content-Type:text/plain" --data 'LINK_TO_TWEET'
 *
 * @param {!Object} req Cloud Function request context.
 * @param {!Object} res Cloud Function response context.
 */
exports.twitterFavGyazo = function twitterFavGyazo(req, res) {
  if (req.method !== 'POST' || req.get('content-type') !== 'text/plain') {
    console.error('not a valid request');
    res.status(405).end();
    return;
  }

  // const { statusId } = req.query;

  const linkToTweet = req.body;
  console.log(`linkToTweet: ${linkToTweet}`);
  const statusId = linkToTweet.split('/').pop(); // get last element
  console.log(`status_id: ${statusId}`);

  getStatus(statusId, (text, medias) => {
    for (const [expandedUrl, mediaUrlHttps] of medias) {
      https.get(mediaUrlHttps, (imgRes) => {
        if (imgRes.statusCode !== 200) {
          console.error(`failed to download image status: ${imgRes.statusCode}`);
          return;
        }

        const title = '';
        // escape hashtag
        const desc = text.replace(/#/g, '');

        uploadToGyazo(imgRes, expandedUrl, title, desc, () => {
          // FIXME don't call end() unless all requests finishes
          res.status(200).end();
        });
      });
    }
  });
};
