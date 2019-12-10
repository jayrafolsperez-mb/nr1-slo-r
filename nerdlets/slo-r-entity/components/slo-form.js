import React from 'react';
import PropTypes from 'prop-types';

import {
  Button,
  Dropdown,
  DropdownItem,
  HeadingText,
  NerdGraphQuery,
  TextField
} from 'nr1';

/** 3rd party */
import { Multiselect } from 'react-widgets';

import {
  validateSlo,
  sloDocumentModel,
  writeSloDocument,
  fetchDocumentById
} from '../../shared/services/slo-documents';

// entities
import { fetchEntity } from '../../shared/services/entity';
import { SLO_INDICATORS, SLO_DEFECTS } from '../../shared/constants';

export default class SloForm extends React.Component {
  static propTypes = {
    entityGuid: PropTypes.string,
    documentId: PropTypes.string,
    upsertDocumentCallback: PropTypes.func,
    modalToggleCallback: PropTypes.func
  };

  static defaultProps = {
    documentId: undefined
  };

  constructor(props) {
    super(props);

    this.state = {
      isNew: false,
      document: undefined,

      // Related data
      entityDetails: null,
      transactions: null,

      // Form options populated from nrql
      alertOptions: [],
      transactionOptions: []
    };

    if (!props.documentId) {
      this.state.isNew = true;
      this.state.document = sloDocumentModel.create();
    }

    this.upsertHandler = this.upsertHandler.bind(this);
  }

  async componentDidMount() {
    const { entityGuid, documentId } = this.props;

    if (this.props.documentId) {
      await this.getDocumentById({ entityGuid, documentId });
    }

    // TO DO - change to something that executes all 3 at once
    // Either promise.all or callbacks
    await this._getEntityInformation();
    await this._updateAlertConfig();
    await this._loadEntityTransactions();
  }

  async componentDidUpdate(prevProps) {
    const { entityGuid, documentId } = this.props;

    if (documentId && prevProps.documentId !== documentId) {
      await this.getDocumentById({ entityGuid, documentId });
    }

    if (prevProps.entityGuid !== entityGuid) {
      await this._getEntityInformation();
      await this._updateAlertConfig();
      await this._loadEntityTransactions();
    }
  }

  async getDocumentById({ entityGuid, documentId }) {
    if (entityGuid && documentId) {
      const response = await fetchDocumentById({ entityGuid, documentId });

      this.setState({
        document: response,
        isNew: false
      });
    }
  }

  async _getEntityInformation() {
    // get the entityGuid react context
    const { entityGuid } = this.props;

    const entityDetails = await fetchEntity({ entityGuid });
    // console.debug('Context: Entity', __service_entity);

    // set the entity details state
    this.setState({ entityDetails: entityDetails });
  }

  async _updateAlertConfig() {
    const { entityDetails, document } = this.state;

    if (entityDetails && document.alerts.length < 1) {
      const __query = `{
            actor {
              account(id: ${entityDetails.accountId}) {
                nrql(query: "SELECT count(*) FROM SLOR_ALERTS SINCE 12 MONTHS AGO FACET policy_name") {
                  results
                }
              }
            }
          }`;

      const __result = await NerdGraphQuery.query({ query: __query });
      this.setState({
        alertOptions: __result.data.actor.account.nrql.results
      });
    }
  }

  async _loadEntityTransactions() {
    const { entityDetails, transactions } = this.state;

    // we only want to run this the one time to gather transactions
    if (entityDetails && transactions === null) {
      const __query = `{
            actor {
              account(id: ${entityDetails.accountId}) {
                nrql(query: "SELECT count(*) FROM Transaction WHERE appName='${entityDetails.appName}' SINCE 1 MONTH AGO FACET name LIMIT 100") {
                  results
                }
              }
            }
          }`;

      const __result = await NerdGraphQuery.query({ query: __query });
      const transactions = __result.data.actor.account.nrql.results;
      const transactionOptions = transactions.map(transaction => {
        return transaction.name;
      });

      this.setState({ transactions, transactionOptions });
    } // if
  }

  /*
   * Handle user submission of a new SLO document
   */
  upsertHandler(e) {
    // prevent default used to stop form submission to iframe
    e.preventDefault();

    const { entityDetails, document } = this.state;
    const isValid = validateSlo(document);

    if (!isValid) {
      // eslint-disable-next-line no-alert
      alert(
        'Problem with SLO definition! Please validate you have an SLO Name, Organization, and Target defined. Also ensure your Error Budget includes at least one transaction and one defect, or your Alert driven SLO includes an Alert.'
      );
      return;
    }

    let formattedSelectedDefects = [];
    if (formattedSelectedDefects) {
      formattedSelectedDefects = document.defects.map(defect => {
        return defect.value;
      });
    }

    // Merge in entityDetails
    const newDocument = {
      ...document,
      defects: formattedSelectedDefects || [],
      entityGuid: entityDetails.entityGuid,
      accountId: entityDetails.accountId,
      accountName: entityDetails.accountName,
      language: entityDetails.language,
      appName: entityDetails.appName
    };

    // write the document
    this.writeNewSloDocument(newDocument);
  }

  /*
   * Add to NerdStorage and navigate
   */
  async writeNewSloDocument(document) {
    const { entityGuid } = this.props;

    const { mutation, result } = await writeSloDocument({
      entityGuid,
      document
    });

    this.props.upsertDocumentCallback({ document: mutation, response: result });

    // TO DO - reset this.state.newSloDocument if successful, keep if error?
    if (result) {
      this.setState({ document: sloDocumentModel.create() });
    }
  }

  inputHandler({ field, value }) {
    this.setState(previousState => {
      const updatedDocument = {
        ...previousState.document
      };
      updatedDocument[field] = value;

      return {
        ...previousState,
        document: updatedDocument
      };
    });
  }

  getValue({ field }) {
    const { documentId } = this.props;
    const { document } = this.state;

    // Error loading document for editing
    if (documentId && !document) {
      throw new Error('Error populating document for edit');
    }

    // Find value on the document being edited
    if ((documentId && document) || !documentId) {
      let value = document[field];

      // TO DO - Remove for v1
      // We've changed the SLO attributes, account for pre-existing documents that include 'type'
      if (field === 'indicator' && !value) {
        value = document.type;
      }

      if (value === undefined) {
        throw new Error(`SLO Document field: ${field} not defined`);
      }

      return value;
    }
  }

  dropdownTitleLookup({ name, options }) {
    const value = this.getValue({ field: name });
    const option = options.find(o => o.value === value);

    if (option) {
      return option.label;
    }

    return null;
  }

  renderErrorBudget() {
    const { document, transactionOptions } = this.state;

    if (document.indicator !== 'error_budget') {
      return null;
    }

    return (
      <div>
        <div className="error-budget-dependancy">
          <div className="defects-dropdown-container">
            <h4 className="dropdown-label">Defects</h4>
            <Multiselect
              valueField="value"
              textField="label"
              data={SLO_DEFECTS}
              className="defects-dropdown react-select-dropdown"
              placeholder="Select one or more defects"
              onChange={value =>
                this.inputHandler({
                  field: 'defects',
                  value
                })
              }
              defaultValue={this.getValue({ field: 'defects' })}
            />

            <small className="input-description">
              Defects that occur on the selected transactions will be counted
              against error budget attainment.
            </small>
          </div>
        </div>

        <div className="error-budget-dependancy">
          <div className="transactions-dropdown-container">
            <h4 className="dropdown-label">Transactions</h4>
            <Multiselect
              data={transactionOptions}
              className="transactions-dropdown react-select-dropdown"
              placeholder="Select one or more transactions"
              onChange={value =>
                this.inputHandler({
                  field: 'transactions',
                  value
                })
              }
              defaultValue={this.getValue({ field: 'transactions' })}
            />

            <small className="input-description">
              Select one or more transactions evaluate for defects for this
              error budget.
            </small>
          </div>
        </div>
      </div>
    );
  }

  renderAlerts() {
    const { document } = this.state;
    if (document.indicator === 'error_budget') {
      return null;
    }

    if (document.indicator === '') {
      return null;
    }

    return (
      <div className="error-budget-dependancy">
        <div className="alerts-dropdown-container">
          <h4 className="dropdown-label">Alerts</h4>
          <Multiselect
            data={this.state.alertOptions}
            valueField="policy_name"
            value={this.state.document.alerts}
            allowCreate
            onCreate={value => {
              this.inputHandler({
                field: 'alerts',
                value
              });

              this.setState(prevState => ({
                alertOptions: [...prevState.alertOptions, value]
              }));
            }}
            textField="policy_name"
            className="transactions-dropdown react-select-dropdown"
            placeholder="Select one or more Alerts"
            onChange={value =>
              this.inputHandler({
                field: 'alerts',
                value
              })
            }
            defaultValue={this.getValue({ field: 'alerts' })}
          />

          <small className="input-description">
            Select one or more Alerts that appear in the SLOR_ALERTS event table
            in Insights, or click the "Add Alert" button below to enter the
            policy name of an Alert you your like to associate with this SLO.
            For more information about configuring alerts to be used with SLO/R
            please see the "Configuring Alerts" section of the SLO/R readme
            (https://github.com/newrelic/nr1-csg-slo-r).
          </small>
        </div>
      </div>
    );
  }

  renderFormFields() {
    return (
      <>
        <TextField
          label="SLO name"
          className="define-slo-input"
          onChange={event => {
            this.inputHandler({
              field: 'name',
              value: event.target.value
            });
          }}
          value={this.getValue({ field: 'name' })}
        />

        <TextField
          label="organization"
          className="define-slo-input"
          onChange={() =>
            this.inputHandler({
              field: 'organization',
              value: event.target.value
            })
          }
          value={this.getValue({ field: 'organization' })}
        />

        <TextField
          label="Target Attainment"
          className="define-slo-input"
          onChange={() =>
            this.inputHandler({
              field: 'target',
              value: event.target.value
            })
          }
          value={this.getValue({ field: 'target' })}
        />

        <Dropdown
          title={
            this.dropdownTitleLookup({
              name: 'indicator',
              options: SLO_INDICATORS
            }) || 'Choose an Indicator'
          }
          label="Indicator"
          className="define-slo-input"
        >
          {SLO_INDICATORS.map((indicator, index) => {
            return (
              <DropdownItem
                key={index}
                onClick={() => {
                  this.inputHandler({
                    field: 'indicator',
                    value: indicator.value
                  });
                }}
              >
                {indicator.label}
              </DropdownItem>
            );
          })}
        </Dropdown>
      </>
    );
  }

  render() {
    const { documentId } = this.props;
    const { document, isNew } = this.state;
    const documentIsReady = (documentId && document) || !documentId;

    return (
      <>
        <HeadingText type={HeadingText.TYPE.HEADING_2}>
          Define an SLO
        </HeadingText>
        <p>
          Please provide the information needed to create this SLO below. You
          will be able to edit this information in the future.
        </p>

        {documentIsReady && this.renderFormFields()}
        {documentIsReady && this.renderErrorBudget()}
        {documentIsReady && this.renderAlerts()}

        <Button
          type={Button.TYPE.Secondary}
          onClick={() => this.props.modalToggleCallback()}
        >
          Cancel
        </Button>
        <Button type={Button.TYPE.PRIMARY} onClick={this.upsertHandler}>
          {isNew ? 'Add new service' : 'Update service'}
        </Button>
      </>
    );
  }
}