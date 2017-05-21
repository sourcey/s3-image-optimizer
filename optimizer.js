var aws = require('aws-sdk'),
  s3 = new aws.S3(), //{ apiVersion: '2006-03-01' }
  Imagemin = require('imagemin'),
  async = require('async'),
  fs = require('fs'),
  env = require('dotenv'),
  _ = require('underscore');

// Load environment variables if not already loaded
if (!process.env.AWS_ACCESS_KEY_ID) {
  require('dotenv').load();
  console.log(process.env);
}

var SOURCE_BUCKET = process.env.SOURCE_BUCKET;
var UPLOAD_BUCKET = process.env.UPLOAD_BUCKET;
var UPLOAD_ACL = process.env.UPLOAD_ACL || 'public-read';
var SKIP_FILE_SIZE = +process.env.MAX_FILE_SIZE || -1;

// Imagemin options object for all image types
var imageminOptions = {
  optimizationLevel: (+process.env.PNG_OPTIM_LEVEL || 7),
  progressive: (process.env.JPG_OPTIM_PROGRESSIVE == 'true'),
  interlaced: (process.env.GIF_OPTIM_INTERLACED == 'true')
};

// How many keys to retrieve with a single request to the S3 API.
// Larger key sets require paging and multiple calls.
var maxKeys = 100; // number os keys per query
var processedLog = './processed.log'; // file containing all precessed files
var skippedLog = './skipped.log'; // file containing all skipped files
var markerFile = './.marker'; // file containing current file marker

// Array of S3 keys to process
var keys = [];

// State flags
var isLoadingData = false;
var isComplete = false;

// Optimize a single image from it's AWS key
function processOne(key, callback) {
  console.log('Processing', key);

  async.waterfall([
    function check(next) {
      s3.headObject({ Bucket: SOURCE_BUCKET, Key: key }, function(err, data) {
        if (err) return next(err);

        if (data.Metadata && data.Metadata.optimized) {
          console.log('Image is already optimized. Skipping.');
          return next('skip');
        }

        if (!isImageFile(key)) {
            console.log('File is not an image type. Skipping.');
            return next('skip');
        }

        if (!data.ContentLength) {
            console.log('Image is empty. Skipping.');
            return next('skip');
        }

        // console.log('File size is ' + data.ContentLength + ' bytes');
        if (SKIP_FILE_SIZE !== -1 && data.ContentLength > SKIP_FILE_SIZE) {
          console.log('Image is larger than configured threshold. Skipping.');
          return next('skip');
        }

        next(null, data);
      });
    },

    function download(meta, next) {
      s3.getObject({ Bucket: SOURCE_BUCKET, Key: key }, function(err, data) {
        if (err) return next(err);
        next(null, meta, data);
      });
    },

    function process(meta, obj, next) {
      new Imagemin()
        .src(obj.Body)
        .use(Imagemin.jpegtran(imageminOptions))
        .use(Imagemin.gifsicle(imageminOptions))
        .use(Imagemin.optipng(imageminOptions))
        .use(Imagemin.svgo({plugins: imageminOptions.svgoPlugins || []}))
        .run(function(err, files) {
          if(err) return next(err);
          console.log('Optimized! Final file size reduced from ' + obj.Body.length + ' to ' + files[0].contents.length + ' bytes');
          next(null, meta, obj, files[0])
        });
    },

    function upload(meta, obj, file, next) {
      meta.Metadata.optimized = 'y';

      s3.putObject({
        ACL: UPLOAD_ACL,
        Bucket: UPLOAD_BUCKET || SOURCE_BUCKET,
        Key: key,
        Body: file.contents,
        ContentType: obj.ContentType,
        Metadata: meta.Metadata
      }, function(err) {
        if(err) return next(err);

        console.log('File uploaded', key);
        onImageOptimized(key);
        next();
      });
    }
  ], function(err) {
    if (err === 'skip') {
      fs.appendFileSync(skippedLog, key + '\n'); // add to skipped files log
      updateMarkerFile(key);
      err = null;
    }
    callback(err);
  });
}

function loadLastMarker() {
  if (!fs.existsSync(markerFile))
    return null;
  return fs.readFileSync(markerFile).toString();
}

// Recursive function to be called until there are no files left to optimize.
function processNext() {

  // Do nothing if complete
  if (isComplete)
    return false;

  if (keys.length == 0 && isLoadingData)
    return false;

  // If there are no keys left and not loading then load some more
  if (keys.length == 0) {
    if (!isLoadingData) {
      isLoadingData = true;
      console.log('Listing more keys:', loadLastMarker());
      listKeyPage({
        bucket: SOURCE_BUCKET,
        marker: loadLastMarker()
        //prefix: 'myKey/'
      },
      function (error, nextMarker, keyset) {
        if (error) throw error;

        isLoadingData = false;

        // Update list of keys to process
        keys = keys.concat(keyset);

        // NOTE: Don't set the last marker here.
        // Since the S3 key is the marker we set is after
        // the last image has been optimized.

        if (keys.length > 0) {
          processNext();
          // processTasks();
        } else {
          onComplete();
        }
      });
    }
    return false;
  }

  // Process the next key in the queue
  key = keys.shift();
  // numTasks++;
  processOne(key, function() {
    // numTasks--;
    processNext();
    // processTasks();
  });
  return true;
}

function onImageOptimized(key) {
  updateMarkerFile(key);
  fs.appendFileSync(processedLog, key + '\n'); // add to processed files log
}

function updateMarkerFile(key) {
  fs.writeFileSync(markerFile, key); // update the current market
}

function onComplete() {
  isComplete = true;
  console.log('Optimization complete!');
}

/**
 * List one page of a set of keys from the specified bucket.
 *
 * If providing a prefix, only keys matching the prefix will be returned.
 *
 * If providing a delimiter, then a set of distinct path segments will be
 * returned from the keys to be listed. This is a way of listing "folders"
 * present given the keys that are there.
 *
 * If providing a marker, list a page of keys starting from the marker
 * position. Otherwise return the first page of keys.
 *
 * @param {Object} options
 * @param {String} options.bucket - The bucket name.
 * @param {String} [options.prefix] - If set only return keys beginning with
 *   the prefix value.
 * @param {String} [options.delimiter] - If set return a list of distinct
 *   folders based on splitting keys by the delimiter.
 * @param {String} [options.marker] - If set the list only a paged set of keys
 *   starting from the marker.
 * @param {Function} callback - Callback of the form
    function (error, nextMarker, keys).
 */
function listKeyPage(options, callback) {
  var params = {
    Bucket : options.bucket,
    Delimiter: options.delimiter,
    Marker : options.marker,
    MaxKeys : maxKeys,
    Prefix : options.prefix
  };

  s3.listObjects(params, function (error, response) {
    if (error) {
      return callback(error);
    } else if (response.err) {
      return callback(new Error(response.err));
    }

    // Convert the results into an array of key strings, or
    // common prefixes if we're using a delimiter.
    var keys;
    if (options.delimiter) {
      // Note that if you set MaxKeys to 1 you can see some interesting
      // behavior in which the first response has no response.CommonPrefix
      // values, and so we have to skip over that and move on to the
      // next page.
      keys = _.map(response.CommonPrefixes, function (item) {
        return item.Prefix;
      });
    } else {
      keys = _.map(response.Contents, function (item) {
        return item.Key;
      });
    }

    // Check to see if there are yet more keys to be obtained, and if so
    // return the marker for use in the next request.
    var nextMarker;
    if (response.IsTruncated) {
      if (options.delimiter) {
        // If specifying a delimiter, the response.NextMarker field exists.
        nextMarker = response.NextMarker;
      } else {
        // For normal listing, there is no response.NextMarker
        // and we must use the last key instead.
        nextMarker = keys[keys.length - 1];
      }
    }

    callback(null, nextMarker, keys);
  });
}

// Infer the image type.
function isImageFile(key) {
  var extMatch = key.match(/\.([^.]*)$/);
  if (!extMatch) {
    console.error('Unable to infer image type for key ' + key);
    return false;
  }
  var ext = extMatch[1].toLowerCase();
  if (ext != "jpg" && ext != "jpeg" && ext != "gif" && ext != "png" && ext != "svg") {
    // console.log('skipping non-image ' + key);
    return false;
  }
  return true;
}

module.exports.optimizer = processNext();
