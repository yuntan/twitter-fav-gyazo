// node standard library
import https = require('https');
import { IncomingMessage } from 'http';
import { URL } from 'url';
import { createHmac } from 'crypto';
import { Readable } from 'stream';

// thirdparty packages
import fetch from 'node-fetch';
import FormData = require('form-data');
import OAuth = require('oauth-1.0a');

const config = require('./config.json');

const TWITTER_STATUS_SHOW_URL = 'https://api.twitter.com/1.1/statuses/show.json';
const GYAZO_UPLOAD_URL = 'https://upload.gyazo.com/api/upload';

interface Status {
  text: string
  media: { expandedUrl: string; mediaUrl: string }[]
}

const oauth = new OAuth({
  consumer: {
    key: config.TWITTER_KEY,
    secret: config.TWITTER_SECRET,
  },
  signature_method: 'HMAC-SHA1',
  hash_function: (baseStr: string, key: string) =>
    createHmac('sha1', key).update(baseStr).digest('base64'),
  realm: '',
});

const token = {
  key: config.TWITTER_TOKEN,
  secret: config.TWITTER_TOKEN_SECRET,
};

async function getStatus(statusId: string): Promise<Status> {
  const reqURL = new URL(`${TWITTER_STATUS_SHOW_URL}?id=${statusId}`);
  const requestData = { url: reqURL.href, method: 'GET' };
  const auth_data = oauth.authorize(requestData, token);
  const header = {
    Authorization: oauth.toHeader(auth_data).Authorization,
  };
  const res = await fetch(`${TWITTER_STATUS_SHOW_URL}?id=${statusId}`, {
    headers: header,
  });
  if (!res.ok) throw new Error(`status ${res.status} from twittter`);
  const data = await res.json();

  const text = data['text'] as string;
  console.log(`text: ${text}`);

  if (data.extended_entities === undefined
      || data.extended_entities.media === undefined) {
    console.log('no media found');
    return { text, media: [] };
  }

  // make sure to use https urls
  const media = (data.extended_entities.media as any[])
    .filter(obj => obj['type'] === 'photo')
    .map(obj => ({
      expandedUrl: obj['expanded_url'],
      mediaUrl: obj['media_url_https'],
    }));

  console.log(`found ${media.length} medias`);

  return { text, media };
}

async function uploadToGyazo(
  img: Readable, refererUrl: string, title: string, desc: string,
) {
  const form = new FormData();
  form.append('access_token', config.GYAZO_TOKEN);
  form.append('imagedata', img);
  form.append('referer_url', refererUrl);
  form.append('title', title);
  form.append('desc', desc);

  const res = await fetch(GYAZO_UPLOAD_URL, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`status ${res.status} from gyazo`);
  const data = await res.json();
  console.log(`uploaded to gyazo: ${data.permalink_url}`);
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
exports.twitterFavGyazo = async (req: any, res: any) => {
  if (req.method !== 'POST' || req.get('content-type') !== 'text/plain') {
    console.error('not a valid request');
    res.status(405).end();
    return;
  }

  const linkToTweet = req.body as string;
  const statusId = linkToTweet.split('/').pop()!!; // get last element

  console.log(`linkToTweet: ${linkToTweet}`);
  console.log(`status_id: ${statusId}`);

  const { text, media } = await getStatus(statusId);
  await Promise.all(media.map(async urls => {
    const { expandedUrl, mediaUrl } = urls;

    // WHY: cannot append response body to form-data
    // related? https://github.com/form-data/form-data/issues/399
    // const imgRes = await fetch(mediaUrlHttps);
    // if (!imgRes.ok) {
    //   throw new Error(`failed to download image status: ${imgRes.status}`);
    // }

    const imgRes = await new Promise<IncomingMessage>((resolve) => {
      https.get(mediaUrl, resolve);
    });
    if (imgRes.statusCode !== 200) {
      throw new Error(`failed to download image status: ${imgRes.statusCode}`);
    }

    const title = '';
    await uploadToGyazo(imgRes, expandedUrl, title, text);
  })).then(() => {
    res.status(200);
  }).catch((err) => {
    console.error(err);
    res.status(500);
  });
  res.end();
};
