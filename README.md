# Optim

Automagitically optimize your images on S3 with the magic of AWS Lambda.

Optim is a super-simple [Lambda][l] function that can listen to an S3 bucket for uploads, and runs everything it can through [imagemin][imagemin].


## Setup

 * Clone this repo

 * Run `npm install`

 * Fill in `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in `.env` to a set of credentials that can create Lambda functions (alternatively have these already in your environment)

 * Create an IAM role for Optim to use. It needs the following permissions on all the S3 buckets you want to use (allowing these operations on ARN `*` is easiest to start with):
   * `getObject`
   * `putObject`
   * `putObjectAcl`


 * Find the ARN for this role. It looks something like `arn:aws:iam::1234567890:role/rolename`.

 * Fill in `AWS_ROLE_ARN` in `.env`

 * Run `npm run deploy`

 * Hurrah, your Lambda function is now deployed! It'll be created with the name `optim-production` unless you changed values in `.env`

 * You can now hook this function up to any S3 bucket you like in the management console. Easiest way is to follow [AWS's guide][s3-evt-setup]


## Configuration

There are two sets of configuration here. The `.env` file contains configuration related to setup and deployment, and `runtime.env` is for configuration of how Optim behaves.

In `.env`:

 * `AWS_ACCESS_KEY_ID`: the AWS access key used to deploy the Lambda function
 * `AWS_SECRET_ACCESS_KEY`: the corresponding secret access key
 * `AWS_ROLE_ARN`: role with which the lambda function will be executed
 * `AWS_REGION`: which region to deploy to
 * `AWS_FUNCTION_NAME` and `AWS_ENVIRONMENT` control naming of the lambda function created
 * `AWS_MEMORY_SIZE` is the amount of memory given to your Lambda. It's also related to how much CPU share it gets. Since optimizing images is fairly intensive, probably best to keep this high
 * `AWS_TIMEOUT` runtime timeout for the lambda in seconds up to 5 minutes. Again, image optimization is fairly intensive so you'll probably want to leave this at the maximum of 300.

In `runtime.env`:

 * `UPLOAD_ACL`: finalised images will be uploaded with this permission level. Should be one of `private` `public-read` `public-read-write` `aws-exec-read` `authenticated-read` `bucket-owner-read` `bucket-owner-full-control`. Default is `public-read`.
 * `MAX_FILE_SIZE`: files over this size in bytes will be skipped (e.g. big PNGs will probably just hit the timeout anyway). Set to `-1` for no limit
 * `PNG_OPTIM_LEVEL`: Optimization level to use for PNGs, between 0 and 7. Lower level means faster optimization, higher means better results.


[l]: https://aws.amazon.com/lambda/
[imagemin]: https://github.com/imagemin/imagemin
[s3-evt-setup]: http://docs.aws.amazon.com/AmazonS3/latest/UG/SettingBucketNotifications.html
