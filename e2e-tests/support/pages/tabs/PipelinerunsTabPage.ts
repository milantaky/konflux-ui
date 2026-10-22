import { hacAPIEndpoints } from '../../../utils/APIEndpoints';
import { APIHelper } from '../../../utils/APIHelper';
import { Common } from '../../../utils/Common';
import { LogViewerHelper } from '../../../utils/LogViewerHelper';
import { UIhelper } from '../../../utils/UIhelper';
import { activityTabPO, pipelinerunsTabPO } from '../../pageObjects/pages-po';

type taskRunDetailsRow = {
  name: string | RegExp;
  task: string;
  status: string;
};

type ecSecurityRulesRow = {
  rule: string | RegExp;
  status: string | RegExp;
  message: string | RegExp;
};

// Pipelineruns List view page
export class PipelinerunsTabPage {
  static clickOnRunningPipelinerun(pipelinerun: string) {
    UIhelper.clickRowCellInTable('Pipeline run List', 'Running', `${pipelinerun}-`);
  }

  static verifyRelatedPipelines(pipelineName: string) {
    cy.contains(pipelinerunsTabPO.relatedPipelinePopup, 'Related pipelines').within(() => {
      cy.contains(pipelineName).scrollIntoView().should('be.visible');
      cy.get(pipelinerunsTabPO.relatedPipelineCloseBtn).click().should('not.exist');
    });
  }

  static getPipelineRunNameByLabel(
    applicationName: string,
    label: string,
    annotations?: { key: string; value: string },
    retries = 4,
  ) {
    return APIHelper.requestHACAPI({
      url: hacAPIEndpoints.pipelinerunsFilter(applicationName, label),
    })
      .its('body.items')
      .then((items) => {
        if (items.length < 1 && retries > 0) {
          cy.wait(5000);
          return PipelinerunsTabPage.getPipelineRunNameByLabel(
            applicationName,
            label,
            annotations,
            retries--,
          );
        }
        if (!annotations) {
          return items[0].metadata.name;
        }
        for (const i in items) {
          if (items[i].metadata.annotations[annotations.key] === annotations.value) {
            return items[i].metadata.name;
          }
        }
      });
  }

  static verifyECSecurityRulesResultSummary(summary: RegExp) {
    cy.contains(pipelinerunsTabPO.ecResultSummary, summary).should('be.visible');
  }

  static verifyECSecurityRules(UniqueTextInRow: string | RegExp, rowValues: ecSecurityRulesRow) {
    cy.contains(pipelinerunsTabPO.ecSecurityRulesTableRow, UniqueTextInRow).within(() => {
      cy.contains(rowValues.rule).scrollIntoView().should('be.visible');
      cy.contains(rowValues.status).scrollIntoView().should('be.visible');
      cy.contains(rowValues.message).scrollIntoView().should('be.visible');
    });
  }

  static verifyVulnerabilityColumn() {
    cy.get(pipelinerunsTabPO.ariaLabelPipelineRunsListTable).within(() => {
      cy.contains('th', 'Fixable vulnerabilities').should('be.visible');
    });
  }

  static verifyVulnerabilityCellVisibility(componentName: string) {
    UIhelper.getTableRow(pipelinerunsTabPO.pipelineRunsListTable, componentName).within(() => {
      cy.get(pipelinerunsTabPO.vulnerabilityColumn).should('be.visible');
    });
  }

  static verifyVulnerabilityIndicators(componentName: string, expectedPattern: RegExp) {
    UIhelper.getTableRow(pipelinerunsTabPO.pipelineRunsListTable, componentName).within(() => {
      cy.get(pipelinerunsTabPO.vulnerabilityColumn)
        .should('be.visible')
        .invoke('text')
        .should('match', expectedPattern);
    });
  }

  static verifyVulnerabilityScanDetails(componentName: string) {
    UIhelper.getTableRow(pipelinerunsTabPO.pipelineRunsListTable, componentName).within(() => {
      cy.get(pipelinerunsTabPO.vulnerabilityScanStatus).should('have.length.at.least', 1);
    });
  }
}

// Pipelineruns Details view page
export class DetailsTab {
  static goToDetailsTab() {
    UIhelper.clickTab('Details');
  }

  // Polls the pipeline run status until it's no longer "Pending" or "Running".
  // If the status doesn't change after repeated checks, reloads the page and
  // retries, since the UI may not update without a refresh. Uses recursion
  // instead of a loop because Cypress commands are asynchronous and don't
  // support try/catch for flow control.
  //
  // On LOCAL_CLUSTER (kind), the status badge often stays "Running" after the
  // PipelineRun has already Succeeded (stale k8s watch under build load). Do
  // not cy.reload() mid-build (drops :9443) and do not use requestHACAPI
  // (Dex login has no oidc.user access_token). Soft-remount via list → details
  // every few minutes so hooks re-GET status.
  static waitUntilStatusIsNotRunning(
    timeoutDuration: number = 1800000, // 30 minutes
    interval: number = 60000, // 60 seconds
    retries: number = 7, // number of retries before failing the test
  ) {
    if (retries < 0) {
      assert.fail('Pipelinerun is still running after maximum retries');
    }

    if (Cypress.expose('LOCAL_CLUSTER')) {
      DetailsTab.waitUntilFinishedOnLocalCluster(timeoutDuration, interval);
      return;
    }

    const maxAttempts = Math.max(1, Math.floor(timeoutDuration / interval));

    const checkStatus = (attempt: number) => {
      cy.get(pipelinerunsTabPO.statusPO)
        .scrollIntoView()
        .invoke('text')
        .then((statusText) => {
          if (!statusText.includes('Pending') && !statusText.includes('Running')) {
            return;
          }
          if (attempt >= maxAttempts) {
            cy.log(
              `Status is "${statusText}". Reloading page (${retries - 1} ${retries - 1 === 1 ? 'retry' : 'retries'} remaining).`,
            );
            cy.reload();
            this.waitUntilStatusIsNotRunning(timeoutDuration, interval, retries - 1);
            return;
          }
          cy.wait(interval);
          checkStatus(attempt + 1);
        });
    };

    checkStatus(0);
  }

  /**
   * Kind-only: poll the status badge; after ~15m (builds usually done by then),
   * periodically SPA-remount via Activity → Pipeline runs → PLR so hooks re-GET.
   * Activity sub-tabs are not mounted on the details page, so we must open
   * Activity first. Avoids requestHACAPI (no Dex OIDC token) and cy.reload().
   */
  private static waitUntilFinishedOnLocalCluster(timeoutDuration: number, interval: number) {
    const maxAttempts = Math.max(1, Math.floor(timeoutDuration / interval));
    const remountEvery = Math.max(1, Math.floor(300000 / interval)); // ~5 min
    const remountAfter = Math.max(1, Math.floor(900000 / interval)); // ~15 min

    cy.url().then((detailsUrl) => {
      const plrName = detailsUrl.split('/pipelineruns/')[1]?.split(/[/?#]/)[0];
      expect(plrName, 'pipeline run name from URL').to.be.a('string').and.not.be.empty;

      const checkStatus = (attempt: number) => {
        cy.get(pipelinerunsTabPO.statusPO)
          .scrollIntoView()
          .invoke('text')
          .then((statusText) => {
            if (!statusText.includes('Pending') && !statusText.includes('Running')) {
              return;
            }

            if (attempt >= maxAttempts) {
              cy.screenshot('plr-still-running-details');
              assert.fail(
                `Pipelinerun ${plrName} still "${statusText.trim()}" after ${timeoutDuration}ms on local kind. ` +
                  'See /artifacts/kind-debug.',
              );
            }

            cy.wait(interval);
            const nextAttempt = attempt + 1;
            if (nextAttempt >= remountAfter && nextAttempt % remountEvery === 0) {
              cy.log(
                `Kind: soft-remounting ${plrName} details (attempt ${nextAttempt}/${maxAttempts}) ` +
                  'to refresh stale status watch',
              );
              // Details view does not mount activity__tabItem *; open Activity first.
              cy.get(activityTabPO.clickTab, { timeout: 30000 }).click();
              Common.waitForLoad();
              cy.get(pipelinerunsTabPO.clickTab, { timeout: 30000 }).click();
              Common.waitForLoad();
              UIhelper.clickRowCellInTable(
                'Pipeline run List',
                plrName as string,
                plrName as string,
              );
              cy.get(pipelinerunsTabPO.statusPO, { timeout: 60000 }).should('be.visible');
            }
            checkStatus(nextAttempt);
          });
      };

      checkStatus(0);
    });
  }

  static clickOnNode(nodeId: string) {
    cy.get(pipelinerunsTabPO.node(nodeId)).click();
  }

  static checkNodeDrawerPanelResult(section: string, value: string) {
    cy.contains(pipelinerunsTabPO.PF6TableRow, section)
      .contains(value)
      .scrollIntoView()
      .should('be.visible');
  }

  static checkVulScanOnClairDrawer(vulnerabilities: RegExp) {
    cy.get(pipelinerunsTabPO.drawerPanel)
      .contains(pipelinerunsTabPO.listGroup, 'Fixable vulnerabilities scan')
      .contains(vulnerabilities)
      .scrollIntoView()
      .should('be.visible');
  }

  static checkVulScanOnPipelinerunDetails(vulnerabilities: RegExp) {
    cy.contains(pipelinerunsTabPO.listGroup, 'Fixable vulnerabilities scan')
      .contains(vulnerabilities)
      .scrollIntoView()
      .should('be.visible');
  }

  static clickOnVulScanViewLogs() {
    cy.contains(pipelinerunsTabPO.listGroup, 'Fixable vulnerabilities scan')
      .contains('View logs')
      .click();
  }

  static clickOnDrawerPanelLogsTab() {
    cy.get(pipelinerunsTabPO.drawerPanel).contains('button', 'Logs').click();
  }

  static verifyLogs(logText: string | RegExp) {
    LogViewerHelper.revealLogText(logText, { assertInitiallyFolded: true });
  }

  static closeDrawerPanel() {
    cy.get(pipelinerunsTabPO.drawerClose).click().should('not.exist');
  }

  static downloadSBOMAndCheckUsingCosign() {
    cy.contains(pipelinerunsTabPO.listGroup, 'Download SBOM')
      .find('input')
      .invoke('val')
      .then((value) => {
        cy.exec(`${value}`).then((obj) => {
          expect(obj.exitCode).to.equal(0);
          expect(JSON.parse(obj.stdout).components.length).to.greaterThan(0);
        });
      });
  }

  static waitForPLRAndDownloadAllLogs(
    timeoutDuration: number = 1800000, // 30 minutes
    allTaskLogs = true,
    expectedStatus = 'Succeeded',
  ) {
    // Kind builds are slower and we cannot reload; allow a longer single poll window.
    const effectiveTimeout = Cypress.expose('LOCAL_CLUSTER')
      ? Math.max(timeoutDuration, 2700000) // 45 minutes
      : timeoutDuration;
    DetailsTab.waitUntilStatusIsNotRunning(effectiveTimeout);
    LogsTab.downloadAllTaskLogs(allTaskLogs);
    UIhelper.verifyLabelAndValue('Status', expectedStatus);
  }
}

export class TaskRunsTab {
  static goToTaskrunsTab() {
    UIhelper.clickTab('Task runs');
  }

  static getAdvancedTaskNamesList(pipelineName: string): taskRunDetailsRow[] {
    return [
      { name: `${pipelineName}-init`, task: 'init', status: 'Succeeded' },
      { name: `${pipelineName}-clone-repository`, task: 'clone-repository', status: 'Succeeded' },
      { name: `${pipelineName}-build-container`, task: 'build-container', status: 'Succeeded' },
      {
        name: `${pipelineName}-sast-snyk-check`,
        task: 'sast-snyk-check',
        status: 'Succeeded|Test Failures',
      },
      {
        name: `${pipelineName}-deprecated-base-image-check`,
        task: 'deprecated-base-image-check',
        status: 'Succeeded',
      },
      { name: `${pipelineName}-clair-scan`, task: 'clair-scan', status: 'Succeeded|Test Failures' }, // Adding Test Warnings as some packages might have medium vulnerabilities sometimes
      {
        name: `${pipelineName}-clamav-scan`,
        task: 'clamav-scan',
        status: 'Succeeded|Test Failures',
      },
      { name: `${pipelineName}-show-sbom`, task: 'show-sbom', status: 'Succeeded' },
      { name: `${pipelineName}-show-summary`, task: 'show-summary', status: 'Succeeded' },
    ];
  }
  static getbasicTaskNamesList(pipelineName: string): taskRunDetailsRow[] {
    return [
      { name: `${pipelineName}-init`, task: 'init', status: 'Succeeded' },
      { name: `${pipelineName}-clone-repository`, task: 'clone-repository', status: 'Succeeded' },
      { name: `${pipelineName}-build-container`, task: 'build-container', status: 'Succeeded' },
      { name: `${pipelineName}-push-dockerfile`, task: 'push-dockerfile', status: 'Succeeded' },
    ];
  }

  static assertTaskAndTaskRunStatus(taskNames: taskRunDetailsRow[]) {
    taskNames.forEach((taskNameRow) => {
      UIhelper.verifyRowInTable('TaskRun List', taskNameRow.task, [
        new RegExp(`${taskNameRow.status}`),
      ]);
    });
  }
}

export class LogsTab {
  static goToLogsTab() {
    UIhelper.clickTab('Logs');
  }

  static downloadAllTaskLogs(allTaskLogs = true) {
    LogsTab.goToLogsTab();
    // Open the download dropdown menu first
    cy.get('button[aria-label="Download logs"]').click();
    if (allTaskLogs) {
      cy.contains('[role="menuitem"]', pipelinerunsTabPO.downloadAllTaskLogsButton)
        .should('be.visible')
        .click();
    } else {
      cy.contains('[role="menuitem"]', /^Download$/)
        .should('be.visible')
        .click();
    }
    DetailsTab.goToDetailsTab();
  }
}
