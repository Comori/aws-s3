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

import { SSMClient, SendCommandCommand } from '@aws-sdk/client-ssm'

export class MainRunner {
  AWS_KEY_ID: string
  SECRET_ACCESS_KEY: string

  // S3
  s3?: S3Client
  BUCKET?: string
  REGION?: string
  SOURCE_FILES?: string[]
  TARGET_DIR?: string

  // CloudFront
  cloudFront?: CloudFrontClient
  INVALIDATION_PATH?: string[]
  DISTRIBUTION_ID?: string

  // ssm
  ssm?: SSMClient
  SSM_DOCUMENT_NAME?: string
  SSM_TARGET?: string[]
  SSM_DOCUMENT_VERSION?: string
  SSM_PARAMETERS?: string[]

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

    this.SSM_DOCUMENT_NAME = core.getInput('document-name')
    this.SSM_TARGET = core.getMultilineInput('command-targets')
    this.SSM_DOCUMENT_VERSION = core.getInput('document-version')
    this.SSM_PARAMETERS = core.getMultilineInput('command-parameters')

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

    if (isNotEmpty(this.SSM_DOCUMENT_NAME) && isArryNotEmpty(this.SSM_TARGET)) {
      this.ssm = new SSMClient({
        region: 'us-east-1',
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

      if (this.ssm) {
        core.info(`📝 SSM Document Name: ${this.SSM_DOCUMENT_NAME}`)
        if (!isNotEmpty(this.SSM_DOCUMENT_VERSION)) {
          this.SSM_DOCUMENT_VERSION = '$DEFAULT'
        }

        const commandTargets = parseCommandTargets(this.SSM_TARGET!)
        const commandParameters = parseCommandParameters(this.SSM_PARAMETERS!)

        const params = {
          DocumentName: this.SSM_DOCUMENT_NAME,
          DocumentVersion: this.SSM_DOCUMENT_VERSION,
          Targets: commandTargets,
          Parameters: commandParameters,
          TimeoutSeconds: 600,
          MaxConcurrency: '50',
          MaxErrors: '0'
        }

        const ssmRsp = await this.ssm.send(new SendCommandCommand(params))
        if (ssmRsp && isHttpSuccess(ssmRsp.$metadata.httpStatusCode)) {
          core.info(
            `✅ SSM Command sent successfully: ${ssmRsp.Command?.CommandId}`
          )
        } else {
          const ssmRspJson = JSON.stringify(ssmRsp)
          core.error(`❌ Error sending SSM Command: ${ssmRspJson}`)
          core.setFailed(ssmRspJson)
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

function parseCommandTargets(
  inputArray: string[]
): { Key: string; Values: string[] }[] {
  const targets = []
  let currentTarget: { Key: string; Values: string[] } = { Key: '', Values: [] }

  for (const item of inputArray) {
    const [prop, value] = item.split('=')

    if (prop === 'key') {
      // 遇到新的 key，将上一个完成的对象推入数组，并开始一个新的对象
      if (Object.keys(currentTarget).length > 0) {
        targets.push(currentTarget)
      }
      currentTarget = {
        Key: value,
        Values: []
      }
    } else if (prop === 'values') {
      // 遇到 values，将其分割并赋值
      if (currentTarget.Key) {
        currentTarget.Values = value.split(',')
      }
    }
  }

  // 推入最后一个完成的对象
  if (Object.keys(currentTarget).length > 0) {
    targets.push(currentTarget)
  }

  return targets
}

/**
 * 将键值对字符串数组转换为 SSM SendCommand 的 Parameters 对象格式。
 * @param {string[]} inputArray 格式为 ["key=value", ...] 的数组。
 * @returns {object} 转换后的 Parameters 对象。
 */
function parseCommandParameters(inputArray: string[]): {
  [key: string]: string[]
} {
  const params: { [key: string]: string[] } = {}
  for (const item of inputArray) {
    const parts = item.split('=')
    if (parts.length === 2) {
      const key = parts[0]
      const value = parts[1]
      params[key] = [value] // 将值封装到数组中
    }
  }
  return params
}

export class TestRunner {
  test(): void {
    core.info('test')
  }
}
