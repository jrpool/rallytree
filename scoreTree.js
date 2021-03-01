// Serves the score report page.
const serveScoreReport = op => {
  const {
    err,
    fs,
    globals,
    reportPrep,
    reportScriptPrep,
    scorePriorities,
    scoreRisks,
    servePage
  } = op;
  fs.readFile('scoreReport.html', 'utf8')
  .then(
    htmlContent => {
      fs.readFile('report.js', 'utf8')
      .then(
        jsContent => {
          const newJSContent = reportScriptPrep(jsContent, '/scoretally', [
            'total',
            'verdicts',
            'scoreVerdicts',
            'passes',
            'fails',
            'defects',
            'major',
            'minor',
            'score',
            'numerator',
            'denominator',
            'error'
          ]);
          const newContent = reportPrep(htmlContent, newJSContent)
          .replace('__riskMin__', globals.scoreWeights.risk[scoreRisks[0]])
          .replace('__priorityMin__', globals.scoreWeights.priority[scorePriorities[0]])
          .replace('__riskMax__', globals.scoreWeights.risk[scoreRisks.slice(-1)])
          .replace('__priorityMax__', globals.scoreWeights.priority[scorePriorities.slice(-1)]);
          servePage(newContent, true);
        },
        error => err(error, 'reading report script')
      );
    },
    error => err(error, 'reading scoreReport page')
  );
};
// Handles score requests.
const scoreHandle = (op, bodyObject) => {
  const {
    err,
    globals,
    scorePriorities,
    scoreRisks
  } = op;
  // Checks for weight errors.
  const validateWeights = (name, min, max) => {
    const context = 'retrieving score';
    const minNumber = Number.parseInt(min);
    const maxNumber = Number.parseInt(max);
    if (Number.isNaN(minNumber) || Number.isNaN(maxNumber)) {
      err(`Nonnumeric ${name} weight`, context);
    }
    else if (minNumber < 0 || maxNumber < 0) {
      err(`Negative ${name} weight`, context);
    }
    else if (maxNumber < minNumber) {
      err(`Maximum ${name} weight smaller than minimum`, context);
    }
  };
  // Sets the score weights.
  const setScoreWeights = (key, values, min, max) => {
    const minNumber = Number.parseInt(min, 10);
    globals.scoreWeights[key] = {};
    for (let i = 0; i < values.length; i++) {
      globals.scoreWeights[key][values[i]]
        = minNumber
        + i * (Number.parseInt(max, 10) - minNumber) / (values.length - 1);
    }
  };
  const {scoreRiskMin, scoreRiskMax, scorePriorityMin, scorePriorityMax} = bodyObject;
  // Validate the weights.
  validateWeights('risk', scoreRiskMin, scoreRiskMax);
  if (! globals.isError) {
    validateWeights('priority', scorePriorityMin, scorePriorityMax);
    if (! globals.isError) {
      // Set the score weights.
      setScoreWeights('risk', scoreRisks, scoreRiskMin, scoreRiskMax);
      setScoreWeights('priority', scorePriorities, scorePriorityMin, scorePriorityMax);
      // Serve a report of the scores.
      serveScoreReport(op);
    }
  }
};
// Reports scores and tallies of test results and defects.
const scoreTree = (op, storyRef) => {
  const {globals, totals, err, shorten, report, getItemData, getCollectionData} = op;
  // Get data on the user story.
  getItemData(storyRef, [], ['Children', 'TestCases'])
  .then(
    // When the data arrive:
    data => {
      if (! globals.isError) {
        // Get data on the test cases of the user story, if any.
        getCollectionData(
          data.testCases.count ? data.testCases.ref : '',
          ['LastVerdict', 'Risk', 'Priority'],
          ['Defects']
        )
        .then(
          // When the data, if any, arrive:
          cases => {
            // Process the test cases in parallel.
            cases.forEach(testCase => {
              if (! globals.isError) {
                const verdict = testCase.lastVerdict;
                const riskWeight = globals.scoreWeights.risk[testCase.risk];
                const priorityWeight = globals.scoreWeights.priority[testCase.priority];
                const weight = Number.parseInt(riskWeight) + Number.parseInt(priorityWeight);
                const defectsCollection = testCase.defects;
                let newNumerator;
                report([['total']]);
                if (verdict === 'Pass') {
                  newNumerator = totals.numerator + weight;
                  report([
                    ['verdicts'],
                    ['scoreVerdicts'],
                    ['passes'],
                    [
                      'score',
                      Math.round(
                        newNumerator ? 100 * newNumerator / (totals.denominator + weight) : 0
                      ) - totals.score
                    ],
                    ['numerator', weight],
                    ['denominator', weight]
                  ]);
                }
                else if (verdict === 'Fail') {
                  newNumerator = totals.numerator;
                  report([
                    ['verdicts'],
                    ['scoreVerdicts'],
                    ['fails'],
                    [
                      'score',
                      Math.round(
                        newNumerator ? 100 * newNumerator / (totals.denominator + weight) : 0
                      ) - totals.score
                    ],
                    ['denominator', weight]
                  ]);
                }
                else if (verdict !== null) {
                  report([['verdicts']]);
                }
                // If the test case has any defects:
                /*
                  NOTICE: this condition was liberalized temporarily in February 2021 because of a
                  Rally bug that reports all defect counts as 0.
                */
                if (defectsCollection.count >= 0) {
                  // Get data on the defects.
                  getCollectionData(defectsCollection.ref, ['Severity'], [])
                  .then(
                    // When the data arrive:
                    defects => {
                      // Notify the user whether the defect count bug has been corrected.
                      if (defects.length) {
                        if (defectsCollection.count) {
                          console.log(
                            'Rally defect-count bug has been corrected! Revise scoreTree().'
                          );
                        }
                        else {
                          console.log('Rally defect-count bug not yet corrected!');
                        }
                      }
                      report([['defects', defects.length]]);
                      // Process their severities.
                      const severities = defects
                      .map(defect => defect.severity)
                      .reduce((tally, score) => {
                        tally[score]++;
                        return tally;
                      }, {
                        'Minor Problem': 0,
                        'Major Problem': 0
                      });
                      report([
                        ['major', severities['Major Problem']],
                        ['minor', severities['Minor Problem']]
                      ]);
                    },
                    error => err(error, 'getting data on defects')
                  );
                }
              }
              else {
                return;
              }
            });
          },
          error => err(error, `getting data on test cases ${data.testCases.ref}`)
        );
        // Get data on the child user stories of the user story, if any.
        getCollectionData(data.children.count ? data.children.ref : '', [], [])
        .then(
          // When the data, if any, arrive:
          children => {
            // Process the children in parallel.
            children.forEach(child => {
              if (! globals.isError) {
                const childRef = shorten(
                  'hierarchicalrequirement', 'hierarchicalrequirement', child.ref
                );
                if (! globals.isError) {
                  scoreTree(op, childRef);
                }
              }
            });
          },
          error => err(error, 'getting data on child user stories')
        );
      }
    },
    error => err(error, 'getting data on user story')
  );
};
exports.scoreHandle = scoreHandle;
exports.scoreTree = scoreTree;
