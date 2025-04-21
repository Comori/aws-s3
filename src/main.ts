import * as core from '@actions/core'
import * as glob from '@actions/glob'
import fs, { statSync, Stats } from 'fs'
import path from 'path'
import { lookup } from 'mime-types'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import {
  CloudFrontClient,
  CreateInvalidationCommand
} from '@aws-sdk/client-cloudfront'

export class MainRunner {
  AWS_KEY_ID: string
  SECRET_ACCESS_KEY: string
  BUCKET?: string
  REGION?: string
  SOURCE_FILES?: string[]
  TARGET_DIR?: string

  INVALIDATION_PATH?: string[]
  DISTRIBUTION_ID?: string

  s3?: S3Client
  cloudFront?: CloudFrontClient

  constructor() {
    this.AWS_KEY_ID = core.getInput('aws-access-key-id', { required: true })
    this.SECRET_ACCESS_KEY = core.getInput('aws-secret-access-key', {
      required: true
    })
    this.REGION = core.getInput('aws-region')
    this.BUCKET = core.getInput('bucket')
    this.SOURCE_FILES = core.getMultilineInput('source-files')
    this.TARGET_DIR = core.getInput('target-dir')

    this.INVALIDATION_PATH = core.getMultilineInput('invalidation-path')
    this.DISTRIBUTION_ID = core.getInput('distribution-id')

    if (
      isNotEmpty(this.BUCKET) &&
      isArryNotEmpty(this.SOURCE_FILES) &&
      isNotEmpty(this.TARGET_DIR)
    ) {
      this.s3 = new S3Client({
        region: this.REGION,
        credentials: {
          accessKeyId: this.AWS_KEY_ID,
          secretAccessKey: this.SECRET_ACCESS_KEY
        }
      })
    }

    if (
      isNotEmpty(this.DISTRIBUTION_ID) &&
      isArryNotEmpty(this.INVALIDATION_PATH)
    ) {
      this.cloudFront = new CloudFrontClient({
        region: this.REGION,
        credentials: {
          accessKeyId: this.AWS_KEY_ID,
          secretAccessKey: this.SECRET_ACCESS_KEY
        }
      })
    }
  }

  async run(): Promise<boolean> {
    try {
      if (this.s3) {
        const rootGlobber = await glob.create('./')
        const rootDir = rootGlobber.getSearchPaths()
        core.info(`🗃️ rootDir === ${rootDir}`)

        const globber = await glob.create(this.SOURCE_FILES!.join('\n'))
        const filePathList = await globber.glob()
        core.info(`📋 files to upload:\n${filePathList.join('\n')}`)
        for (const filePath of filePathList) {
          const key = `${this.TARGET_DIR}${autoFixPath(
            filePath.replace(rootDir[0], '')
          )}`

          if (isDirectory(filePath)) {
            continue
          }

          const contentType = lookup(filePath).toString()

          core.info(
            `⤴️ start upload: ${filePath}, s3Path =  ${key}, contentType= ${contentType}`
          )

          // 创建一个 PutObjectCommand 实例
          const putObjectCommand = new PutObjectCommand({
            Bucket: this.BUCKET,
            Key: key,
            Body: fs.createReadStream(filePath),
            ContentType: contentType
          })
          const ur = await this.s3.send(putObjectCommand)
          if (ur && isHttpSuccess(ur.$metadata.httpStatusCode)) {
            core.info(`✅ ${key} uploaded successfully: ${JSON.stringify(ur)}`)
          } else {
            const urJson = JSON.stringify(ur)
            core.error(`❌ ${key} Error uploading file: ${urJson}`)
            core.setFailed(urJson)
          }
        }
      }

      if (this.cloudFront) {
        core.info(
          `🗑️ paths to invalidation:\n${this.INVALIDATION_PATH?.join('\n')}`
        )
        // 创建一个 CreateInvalidationCommand 实例
        const invalidationCommand = new CreateInvalidationCommand({
          DistributionId: this.DISTRIBUTION_ID,
          InvalidationBatch: {
            CallerReference: Date.now().toString(),
            Paths: {
              Quantity: this.INVALIDATION_PATH!.length,
              Items: this.INVALIDATION_PATH
            }
          }
        })

        const ir = await this.cloudFront.send(invalidationCommand)
        if (ir && isHttpSuccess(ir.$metadata.httpStatusCode)) {
          core.info(`✅ invalidation successfully: ${JSON.stringify(ir)}`)
        }
      }
    } catch (error) {
      core.error(`❌ happen Error : ${error}`)
      core.setFailed(`${error}`)
    }
    return true
  }

  test(): void {
    core.info('test!')
  }
}

function isNotEmpty(text?: string): boolean {
  return text != null && text.length > 0
}

function isArryNotEmpty(text?: string[]): boolean {
  return text != null && text.length > 0
}

function isHttpSuccess(code?: number): boolean {
  return code != null && code >= 200 && code < 400
}

function autoFixPath(rawPath: string): string {
  const splitPath = rawPath.split(path.sep)
  if (splitPath && splitPath.length > 0) {
    return splitPath.join('/')
  }
  return rawPath
}

function isDirectory(filePath: string): boolean {
  try {
    const stat: Stats = statSync(filePath)
    return stat.isDirectory()
  } catch (e) {
    // 如果路径不存在，则不是文件夹
    return false
  }
}

export class TestRunner {
  test(): void {
    core.info('test')
  }
}
