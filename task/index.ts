import * as path from 'path'
import taskLib = require('azure-pipelines-task-lib/task')
import tr = require('azure-pipelines-task-lib/toolrunner')
import { AzureDevOpsAPI } from './AzureDevOpsAPI'
import { GitleaksTool } from './gitleakstool'
import { getAzureDevOpsInput, getAzureDevOpsVariable } from './helpers'

async function run () {
  try {
    taskLib.setResourcePath(path.join(__dirname, 'task.json'), true)
    console.log(taskLib.loc('ThanksToZacharyRice'))
    console.log(taskLib.loc('ThanksToJesseHouwing'))
    console.log()

    const operatingSystem = getAzureDevOpsVariable('Agent.OS')
    const architecture = getAzureDevOpsVariable('Agent.OSArchitecture')
    const agentTempDirectory = getAzureDevOpsVariable('Agent.TempDirectory')

    const specifiedVersion = taskLib.getInput('version') || 'latest'
    const scanfolder = getAzureDevOpsInput('scanfolder')
    const configType = taskLib.getInput('configtype') || 'default'
    const gitleaksArguments = taskLib.getInput('arguments')

    const predefinedConfigFile = taskLib.getInput('predefinedconfigfile')
    const customConfigFile = taskLib.getInput('configfile')
    const nogit = taskLib.getBoolInput('nogit')
    const scanonlychanges = taskLib.getBoolInput('scanonlychanges')
    const reportformat = taskLib.getInput('reportformat') || 'json'
    const taskfailString = taskLib.getInput('taskfail')
    let taskfail = true
    if (taskfailString === 'false') { taskfail = false }

    const gitleaksTool: GitleaksTool = new GitleaksTool('gitleaks', specifiedVersion, operatingSystem, architecture)
    const configFileParameter = gitleaksTool.getGitLeaksConfigFileParameter(configType, nogit, predefinedConfigFile, customConfigFile)
    const reportPath = gitleaksTool.getGitleaksReportPath(agentTempDirectory, reportformat)

    const cachedTool = await gitleaksTool.getTool()
    const toolRunner: tr.ToolRunner = new tr.ToolRunner(cachedTool)

    taskLib.debug(taskLib.loc('ScanFolder', scanfolder))
    taskLib.debug(taskLib.loc('ReportPath', reportPath))

    // Replaces Windows \ because of bug in TOML Loader
    toolRunner.arg([`--path=${scanfolder.replace(/\\/g, '/')}`])
    toolRunner.arg([`--report=${reportPath.replace(/\\/g, '/')}`])
    toolRunner.arg([`--format=${reportformat}`])
    if (configFileParameter) toolRunner.arg([`${configFileParameter}`])
    if (nogit) toolRunner.arg(['--no-git'])
    toolRunner.argIf(taskLib.getBoolInput('verbose'), ['--verbose'])
    toolRunner.argIf(taskLib.getBoolInput('redact'), ['--redact'])
    if (scanonlychanges) {
      const azureDevOpsAPI: AzureDevOpsAPI = new AzureDevOpsAPI()
      const commitsFile = await azureDevOpsAPI.getBuildChangesInFile(agentTempDirectory)
      toolRunner.arg([`--commits-file=${commitsFile}`])
      const depth = taskLib.getInput('depth')
      toolRunner.argIf(depth, [`--depth=${depth}`])
    }

    // Process extra arguments
    if (gitleaksArguments) {
      // Split on argument delimiter
      const argumentArray = gitleaksArguments.split('--')
      argumentArray.shift()
      for (const arg of argumentArray) {
        toolRunner.arg([`--${arg.replace(/\\/g, '/').trim()}`])
      }
    }

    // Set options to run the toolRunner
    const options: tr.IExecOptions = {
      failOnStdErr: false,
      ignoreReturnCode: true,
      silent: false,
      outStream: process.stdout,
      errStream: process.stderr
    }

    const result: number = await toolRunner.exec(options)

    if (result === 0) {
      taskLib.setResult(taskLib.TaskResult.Succeeded, taskLib.loc('ResultSuccess'))
    } else {
      if (taskLib.exist(reportPath) && taskLib.getBoolInput('uploadresults')) {
        let containerFolder = 'gitleaks'
        if (reportformat === 'sarif') {
          containerFolder = 'CodeAnalysisLogs'
        }

        taskLib.debug(taskLib.loc('UploadResults', containerFolder))
        taskLib.uploadArtifact(containerFolder, reportPath, containerFolder)
      }
      if (taskfail) {
        taskLib.setResult(taskLib.TaskResult.Failed, taskLib.loc('ResultError'))
      } else {
        taskLib.setResult(taskLib.TaskResult.SucceededWithIssues, taskLib.loc('ResultError'))
      }
    }
  } catch (err) {
    taskLib.setResult(taskLib.TaskResult.Failed, err as string)
  }
}

run()
