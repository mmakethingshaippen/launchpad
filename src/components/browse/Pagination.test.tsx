import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pagination, paginationRange } from './Pagination';

describe('paginationRange', () => {
  it('returns all pages when the count is small', () => {
    expect(paginationRange(1, 3)).toEqual([1, 2, 3]);
  });
  it('inserts ellipses around the current page for large counts', () => {
    expect(paginationRange(5, 76)).toEqual([1, 'ellipsis', 4, 5, 6, 'ellipsis', 76]);
  });
  it('keeps the first pages contiguous near the start', () => {
    expect(paginationRange(1, 76)).toEqual([1, 2, 'ellipsis', 76]);
  });
  it('keeps the last pages contiguous near the end', () => {
    expect(paginationRange(76, 76)).toEqual([1, 'ellipsis', 75, 76]);
  });
});

describe('Pagination component', () => {
  it('renders the summary and disables Previous on page 1', () => {
    render(<Pagination page={1} pageSize={21} total={1592} noun="opportunities" onPageChange={() => {}} />);
    expect(screen.getByTestId('pagination-summary')).toHaveTextContent(
      'Showing 1–21 of 1,592 opportunities',
    );
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });

  it('fires onPageChange with the clicked page number', async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<Pagination page={1} pageSize={21} total={1592} noun="opportunities" onPageChange={onPageChange} />);
    await user.click(screen.getByRole('button', { name: 'Page 76' }));
    expect(onPageChange).toHaveBeenCalledWith(76);
  });

  it('renders nothing when there are no results', () => {
    const { container } = render(
      <Pagination page={1} pageSize={21} total={0} noun="opportunities" onPageChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
