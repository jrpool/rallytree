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
                  scoreTree(childRef);
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
module.exports = [scoreTree];
