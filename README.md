# AWS S3 upload file and Cloudfront invalidation

[![GitHub Super-Linter](https://github.com/actions/typescript-action/actions/workflows/linter.yml/badge.svg)](https://github.com/super-linter/super-linter)
![CI](https://github.com/actions/typescript-action/actions/workflows/ci.yml/badge.svg)
[![Check dist/](https://github.com/actions/typescript-action/actions/workflows/check-dist.yml/badge.svg)](https://github.com/actions/typescript-action/actions/workflows/check-dist.yml)
[![CodeQL](https://github.com/actions/typescript-action/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/actions/typescript-action/actions/workflows/codeql-analysis.yml)
[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

A Github Action that lets you upload file and create `invalidation` in cloudfront during your workflows.

> This action support: `linux`, `windows`, `macos`

## Usage

See [action.yml](action.yml)

**Basic**:

This is basic useage to upload files to `s3`.

```yaml
- name: aws-s3-cloudfront
  uses: Comori/aws-s3@v0.1.3
  with:
    aws-access-key-id: ${{ secrets.AWS_KEY }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_KEY }}
    aws-region: us-east-1
    bucket: ${{ secrets.S3_WIN_BUCKET }}
    source-files: |
      dist/latest.yml
      dist/*.exe
    target-dir: test
```

**CloudFront Invalidation**

If you want to create an invalidation in `CloudFront`, Example:

```yaml
- name: aws-s3-cloudfront
  uses: Comori/aws-s3@v0.1.3
  with:
    aws-access-key-id: ${{ secrets.AWS_KEY }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_KEY }}
    aws-region: us-east-1
    invalidation-path: |
      /test/*
    distribution-id: ${{ secrets.DISTRIBUTION_ID }}
```
> DISTRIBUTION_ID will be found at [https://console.aws.amazon.com/cloudfront/v4/home]

